import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireDomain } from '../auth';
import { pool, q } from '../db';

const Filters = z.object({
  q: z.string().trim().optional(),
  action: z.enum(['accept_all', 'reject_all', 'custom', 'withdraw', 'gpc_opt_out', 'implied']).optional(),
  country: z.string().length(2).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

function where(domainId: string, f: z.infer<typeof Filters>) {
  const clauses = ['domain_id = $1'];
  const params: unknown[] = [domainId];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    clauses.push(sql.replace('?', `$${params.length}`));
  };
  if (f.q) {
    if (/^[0-9a-f-]{36}$/i.test(f.q)) add('consent_id = ?', f.q);
    else add('page_url ILIKE ?', `%${f.q}%`);
  }
  if (f.action) add('action = ?', f.action);
  if (f.country) add('country = ?', f.country.toUpperCase());
  if (f.from) add('created_at >= ?::date', f.from);
  if (f.to) add(`created_at < (?::date + interval '1 day')`, f.to);
  return { sql: clauses.join(' AND '), params };
}

const CSV_COLUMNS = ['created_at', 'consent_id', 'action', 'preferences', 'statistics', 'marketing', 'banner_version', 'regulation', 'country', 'region', 'ip_truncated', 'gpc', 'page_url', 'user_agent'] as const;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function consentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { id: string } }>('/api/domains/:id/consents', async (req) => {
    const d = await requireDomain(req, req.params.id);
    const f = Filters.parse(req.query);
    const w = where(d.id, f);
    const rows = await q(
      `SELECT id, consent_id, action, preferences, statistics, marketing, banner_version, regulation, country, region, ip_truncated, user_agent, page_url, gpc, created_at
       FROM consent_records WHERE ${w.sql} ORDER BY created_at DESC, id DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      w.params,
    );
    const total = await q<{ n: number }>(`SELECT count(*)::int AS n FROM consent_records WHERE ${w.sql}`, w.params);
    return { rows, total: total[0]?.n ?? 0, page: f.page, pageSize: f.pageSize };
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id/consents/export.csv', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const d = await requireDomain(req, req.params.id);
    const f = Filters.parse(req.query);
    const w = where(d.id, f);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="consents-${d.hostname}-${new Date().toISOString().slice(0, 10)}.csv"`);
    // Page through with keyset pagination so large exports do not load into memory.
    const client = await pool.connect();
    const chunks: string[] = [CSV_COLUMNS.join(',') + '\n'];
    try {
      let lastId = Number.MAX_SAFE_INTEGER;
      for (;;) {
        const res = await client.query(
          `SELECT id, ${CSV_COLUMNS.join(', ')} FROM consent_records WHERE ${w.sql} AND id < $${w.params.length + 1} ORDER BY id DESC LIMIT 5000`,
          [...w.params, lastId],
        );
        for (const r of res.rows) chunks.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(',') + '\n');
        if (res.rows.length < 5000) break;
        lastId = Number(res.rows[res.rows.length - 1].id);
      }
    } finally {
      client.release();
    }
    return reply.send(chunks.join(''));
  });

  app.get<{ Params: { id: string }; Querystring: { days?: string } }>('/api/domains/:id/stats', async (req) => {
    const d = await requireDomain(req, req.params.id);
    const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30) || 30));
    const daily = await q<{ day: string; impressions: number; accept_all: number; reject_all: number; custom: number; other: number }>(
      `WITH days AS (SELECT generate_series(current_date - ($2::int - 1), current_date, interval '1 day')::date AS day),
       imp AS (SELECT day, sum(count)::int AS n FROM banner_impressions WHERE domain_id=$1 AND day > current_date - $2::int GROUP BY day),
       rec AS (SELECT created_at::date AS day,
                 count(*) FILTER (WHERE action='accept_all')::int AS accept_all,
                 count(*) FILTER (WHERE action='reject_all')::int AS reject_all,
                 count(*) FILTER (WHERE action='custom')::int AS custom,
                 count(*) FILTER (WHERE action NOT IN ('accept_all','reject_all','custom'))::int AS other
               FROM consent_records WHERE domain_id=$1 AND created_at > current_date - $2::int GROUP BY 1)
       SELECT to_char(days.day, 'YYYY-MM-DD') AS day, COALESCE(imp.n,0) AS impressions, COALESCE(rec.accept_all,0) AS accept_all,
              COALESCE(rec.reject_all,0) AS reject_all, COALESCE(rec.custom,0) AS custom, COALESCE(rec.other,0) AS other
       FROM days LEFT JOIN imp ON imp.day=days.day LEFT JOIN rec ON rec.day=days.day ORDER BY days.day`,
      [d.id, days],
    );
    const totals = daily.reduce(
      (t, r) => ({ impressions: t.impressions + r.impressions, accept_all: t.accept_all + r.accept_all, reject_all: t.reject_all + r.reject_all, custom: t.custom + r.custom, other: t.other + r.other }),
      { impressions: 0, accept_all: 0, reject_all: 0, custom: 0, other: 0 },
    );
    const categories = await q<{ preferences: number; statistics: number; marketing: number; total: number }>(
      `SELECT count(*) FILTER (WHERE preferences)::int AS preferences, count(*) FILTER (WHERE statistics)::int AS statistics,
              count(*) FILTER (WHERE marketing)::int AS marketing, count(*)::int AS total
       FROM consent_records WHERE domain_id=$1 AND created_at > current_date - $2::int`,
      [d.id, days],
    );
    const countries = await q(
      `SELECT COALESCE(country,'--') AS country, count(*)::int AS total,
              count(*) FILTER (WHERE action='accept_all')::int AS accept_all, count(*) FILTER (WHERE action='reject_all')::int AS reject_all
       FROM consent_records WHERE domain_id=$1 AND created_at > current_date - $2::int GROUP BY 1 ORDER BY total DESC LIMIT 10`,
      [d.id, days],
    );
    const decisions = totals.accept_all + totals.reject_all + totals.custom;
    return {
      days,
      daily,
      totals,
      rates: {
        acceptAll: decisions ? totals.accept_all / decisions : null,
        rejectAll: decisions ? totals.reject_all / decisions : null,
        custom: decisions ? totals.custom / decisions : null,
        interaction: totals.impressions ? Math.min(1, decisions / totals.impressions) : null,
      },
      categories: categories[0],
      countries,
    };
  });
}
