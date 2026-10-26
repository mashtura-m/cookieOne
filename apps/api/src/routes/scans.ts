import type { FastifyInstance } from 'fastify';
import { audit, requireAuth, requireDomain } from '../auth';
import { one, q } from '../db';
import { conflict, notFound } from '../errors';

export async function scanRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post<{ Params: { id: string } }>('/api/domains/:id/scans', async (req) => {
    const d = await requireDomain(req, req.params.id, 'editor');
    const active = await one(`SELECT id FROM scans WHERE domain_id=$1 AND status IN ('queued','running')`, [d.id]);
    if (active) throw conflict('A scan is already queued or running for this domain');
    const scan = await one(
      `INSERT INTO scans (domain_id, trigger, requested_by, page_limit) VALUES ($1, 'manual', $2, $3) RETURNING *`,
      [d.id, req.user.id, d.scan_page_limit],
    );
    await audit(d.org_id, req.user.id, 'scan.requested', {}, d.id);
    return scan;
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id/scans', async (req) => {
    const d = await requireDomain(req, req.params.id);
    return q(
      `SELECT s.id, s.status, s.trigger, s.page_limit, s.pages_scanned, s.cookies_found, s.new_items, s.error, s.queued_at, s.started_at, s.finished_at, u.name AS requested_by_name
       FROM scans s LEFT JOIN users u ON u.id=s.requested_by WHERE s.domain_id=$1 ORDER BY s.queued_at DESC LIMIT 50`,
      [d.id],
    );
  });

  app.get<{ Params: { scanId: string } }>('/api/scans/:scanId', async (req) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.scanId)) throw notFound('Scan');
    const scan = await one<{ domain_id: string }>('SELECT * FROM scans WHERE id=$1', [req.params.scanId]);
    if (!scan) throw notFound('Scan');
    await requireDomain(req, scan.domain_id);
    const pages = await q('SELECT url, status_code, error, scanned_at FROM scan_pages WHERE scan_id=$1 ORDER BY id', [req.params.scanId]);
    const findings = await q(
      'SELECT id, kind, name, provider_domain, first_seen_url, category, vendor, attributes, set_before_consent FROM scan_findings WHERE scan_id=$1 ORDER BY kind, category, name',
      [req.params.scanId],
    );
    return { ...scan, pages, findings };
  });
}
