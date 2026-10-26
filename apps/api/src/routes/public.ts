import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { truncateIp } from '@consentflow/shared';
import { q } from '../db';
import { config } from '../config';
import { visitorGeo } from '../lib/geo';
import { buildPublicConfig, inlineJson, loadDomainBundle, type DomainBundle } from '../lib/public-config';

let bundleCache: { at: number; code: string } | null = null;
async function cmpBundle(): Promise<string> {
  if (bundleCache && (process.env.NODE_ENV === 'production' || Date.now() - bundleCache.at < 2000)) return bundleCache.code;
  try {
    bundleCache = { at: Date.now(), code: await readFile(config.cmpBundlePath, 'utf8') };
  } catch {
    bundleCache = { at: Date.now(), code: 'console.error("[ConsentFlow] cmp.js bundle not built. Run: npm run build -w @consentflow/banner");' };
  }
  return bundleCache.code;
}

const ConsentBody = z.object({
  domainKey: z.string().min(8).max(64),
  consentId: z.string().uuid(),
  action: z.enum(['accept_all', 'reject_all', 'custom', 'withdraw', 'gpc_opt_out', 'implied']),
  choices: z.object({ preferences: z.boolean(), statistics: z.boolean(), marketing: z.boolean() }),
  bannerVersion: z.number().int().min(0),
  regulation: z.enum(['gdpr', 'ccpa', 'lgpd', 'none']),
  url: z.string().max(2000).optional(),
  gpc: z.boolean().optional(),
});

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True when the request comes from one of the domain's own hostnames (or subdomains of them). */
export function originAllowed(b: DomainBundle, origin: string | undefined): boolean {
  if (!config.strictOrigin) return true;
  const host = hostOf(origin);
  if (!host) return true; // no Origin header (e.g. some sendBeacon cases): accept, the key is still required
  if (host === 'localhost' || host === '127.0.0.1') return true;
  const allowed = [b.domain.hostname, ...b.domain.extra_hostnames].map((h) => h.replace(/^www\./, ''));
  const h = host.replace(/^www\./, '');
  return allowed.some((a) => h === a || h.endsWith('.' + a));
}

function clientIp(req: FastifyRequest): string {
  const cf = req.headers['cf-connecting-ip'];
  return (Array.isArray(cf) ? cf[0] : cf) || req.ip;
}

function js(reply: FastifyReply, code: string, cache = 'private, max-age=300') {
  return reply.header('content-type', 'application/javascript; charset=utf-8').header('cache-control', cache).header('access-control-allow-origin', '*').send(code);
}

export async function publicRoutes(app: FastifyInstance) {
  // The banner posts consents as text/plain to avoid a CORS preflight on every decision.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      done(Object.assign(new Error('Body must be JSON'), { statusCode: 400 }), undefined);
    }
  });

  app.get('/health', async () => {
    await q('SELECT 1');
    return { ok: true };
  });

  /** The embed script: per-visitor config (geo resolved here) followed by the banner bundle. */
  app.get<{ Params: { key: string } }>('/v1/cmp/:key/cmp.js', async (req, reply) => {
    const b = await loadDomainBundle(req.params.key);
    if (!b) return js(reply.code(404), 'console.warn("[ConsentFlow] Unknown domain key. Check the script URL in your ConsentFlow dashboard.");', 'no-store');
    const cfg = buildPublicConfig(b, visitorGeo(req));
    const code = `window.__CF_CONFIG__=${inlineJson(cfg)};\n${await cmpBundle()}`;
    return js(reply, code);
  });

  app.get<{ Params: { key: string } }>('/v1/cmp/:key/config.json', async (req, reply) => {
    const b = await loadDomainBundle(req.params.key);
    if (!b) return reply.code(404).send({ error: 'Unknown domain key' });
    reply.header('access-control-allow-origin', '*').header('cache-control', 'private, max-age=60');
    return buildPublicConfig(b, visitorGeo(req));
  });

  /** Bundle without config, used by the dashboard's live preview. */
  app.get('/v1/cmp-core.js', async (_req, reply) => js(reply, await cmpBundle(), 'no-cache'));

  app.post<{ Params: { key: string } }>('/v1/cmp/:key/impression', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = await loadDomainBundle(req.params.key);
    reply.header('access-control-allow-origin', '*');
    if (!b || !originAllowed(b, req.headers.origin)) return reply.code(204).send();
    const { country } = visitorGeo(req);
    await q(
      `INSERT INTO banner_impressions (domain_id, day, country, count) VALUES ($1, current_date, $2, 1)
       ON CONFLICT (domain_id, day, country) DO UPDATE SET count = banner_impressions.count + 1`,
      [b.domain.id, country ?? '--'],
    );
    return reply.code(204).send();
  });

  app.post('/v1/consent', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('access-control-allow-origin', '*');
    const parsed = ConsentBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid consent payload', issues: parsed.error.issues.map((i) => i.path.join('.')) });
    const body = parsed.data;
    const b = await loadDomainBundle(body.domainKey);
    if (!b) return reply.code(404).send({ error: 'Unknown domain key' });
    if (!originAllowed(b, req.headers.origin)) return reply.code(403).send({ error: 'Origin is not a hostname of this domain' });
    const { country, region } = visitorGeo(req);
    const ua = req.headers['user-agent'];
    await q(
      `INSERT INTO consent_records (domain_id, consent_id, action, preferences, statistics, marketing, banner_version, regulation, country, region, ip_truncated, user_agent, page_url, gpc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        b.domain.id, body.consentId, body.action, body.choices.preferences, body.choices.statistics, body.choices.marketing,
        body.bannerVersion, body.regulation, country, region, truncateIp(clientIp(req)), typeof ua === 'string' ? ua.slice(0, 400) : null,
        body.url?.slice(0, 1000) ?? null, body.gpc ?? false,
      ],
    );
    return reply.code(201).send({ ok: true });
  });

  /** Lets a visitor look up their own consent history by the ID shown in the declaration (data subject access). */
  app.get<{ Params: { key: string; consentId: string } }>('/v1/cmp/:key/consents/:consentId', async (req, reply) => {
    reply.header('access-control-allow-origin', '*');
    const b = await loadDomainBundle(req.params.key);
    if (!b || !/^[0-9a-f-]{36}$/i.test(req.params.consentId)) return reply.code(404).send({ error: 'Not found' });
    return q(
      `SELECT action, preferences, statistics, marketing, banner_version, regulation, created_at FROM consent_records
       WHERE domain_id=$1 AND consent_id=$2 ORDER BY created_at DESC LIMIT 50`,
      [b.domain.id, req.params.consentId],
    );
  });
}
