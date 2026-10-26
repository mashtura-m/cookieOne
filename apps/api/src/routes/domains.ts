import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireAuth, requireDomain, requireOrg } from '../auth';
import { one, q, tx } from '../db';
import { badRequest, conflict } from '../errors';
import { newPublicKey, normalizeHostname, setupDomain } from '../lib/domain-setup';
import { complianceReport } from '../lib/compliance';
import { invalidateDomainCache } from '../lib/public-config';
import { config } from '../config';

const DomainPatch = z.object({
  extraHostnames: z.array(z.string()).max(20).optional(),
  scanPageLimit: z.number().int().min(1).max(5000).optional(),
  scanFrequency: z.enum(['off', 'weekly', 'monthly']).optional(),
  consentExpiryDays: z.number().int().min(1).max(730).optional(),
  privacyPolicyUrl: z.string().trim().url().max(500).nullable().or(z.literal('')).optional(),
  googleConsentMode: z.boolean().optional(),
  autoBlock: z.boolean().optional(),
});

export function installSnippet(publicKey: string) {
  const src = `${config.publicApiUrl}/v1/cmp/${publicKey}/cmp.js`;
  return {
    scriptUrl: src,
    html: `<script src="${src}"></script>`,
    declarationHtml: `<div id="consentflow-declaration"></div>`,
  };
}

export async function domainRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { orgId: string } }>('/api/orgs/:orgId/domains', async (req) => {
    await requireOrg(req, req.params.orgId);
    return q(
      `SELECT d.id, d.hostname, d.public_key, d.created_at,
        (SELECT row_to_json(s) FROM (SELECT id, status, finished_at, cookies_found FROM scans WHERE domain_id=d.id ORDER BY queued_at DESC LIMIT 1) s) AS last_scan,
        (SELECT count(*)::int FROM consent_records c WHERE c.domain_id=d.id AND c.created_at > now() - interval '30 days') AS consents_30d,
        (SELECT count(*)::int FROM domain_cookies dc WHERE dc.domain_id=d.id) AS cookie_count,
        (SELECT count(*)::int FROM domain_cookies dc WHERE dc.domain_id=d.id AND dc.category='unclassified') AS unclassified_count
       FROM domains d WHERE d.org_id=$1 ORDER BY d.hostname`,
      [req.params.orgId],
    );
  });

  app.post<{ Params: { orgId: string } }>('/api/orgs/:orgId/domains', async (req) => {
    await requireOrg(req, req.params.orgId, 'admin');
    const body = z.object({ hostname: z.string().min(3).max(253), privacyPolicyUrl: z.string().url().optional() }).parse(req.body);
    const hostname = normalizeHostname(body.hostname);
    if (!hostname) throw badRequest('Enter a valid website address, for example example.com');
    const exists = await one('SELECT 1 FROM domains WHERE org_id=$1 AND hostname=$2', [req.params.orgId, hostname]);
    if (exists) throw conflict(`${hostname} is already in this workspace`);
    const domain = await tx(async (c) => {
      const d = (
        await c.query<{ id: string; hostname: string; public_key: string }>(
          'INSERT INTO domains (org_id, hostname, public_key, privacy_policy_url) VALUES ($1,$2,$3,$4) RETURNING id, hostname, public_key',
          [req.params.orgId, hostname, newPublicKey(), body.privacyPolicyUrl ?? null],
        )
      ).rows[0];
      await setupDomain(c, d.id, req.user.id);
      return d;
    });
    await audit(req.params.orgId, req.user.id, 'domain.created', { hostname }, domain.id);
    return { ...domain, install: installSnippet(domain.public_key) };
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id', async (req) => {
    const d = await requireDomain(req, req.params.id);
    return { ...d, install: installSnippet(d.public_key) };
  });

  app.patch<{ Params: { id: string } }>('/api/domains/:id', async (req) => {
    const d = await requireDomain(req, req.params.id, 'editor');
    const b = DomainPatch.parse(req.body);
    const extra = b.extraHostnames?.map((h) => normalizeHostname(h)).filter((h): h is string => !!h);
    const row = await one(
      `UPDATE domains SET
        extra_hostnames = COALESCE($2, extra_hostnames),
        scan_page_limit = COALESCE($3, scan_page_limit),
        scan_frequency = COALESCE($4, scan_frequency),
        consent_expiry_days = COALESCE($5, consent_expiry_days),
        privacy_policy_url = CASE WHEN $6::boolean THEN NULLIF($7, '') ELSE privacy_policy_url END,
        google_consent_mode = COALESCE($8, google_consent_mode),
        auto_block = COALESCE($9, auto_block),
        updated_at = now()
       WHERE id=$1 RETURNING *`,
      [d.id, extra ?? null, b.scanPageLimit ?? null, b.scanFrequency ?? null, b.consentExpiryDays ?? null, b.privacyPolicyUrl !== undefined, b.privacyPolicyUrl ?? null, b.googleConsentMode ?? null, b.autoBlock ?? null],
    );
    invalidateDomainCache(d.public_key);
    await audit(d.org_id, req.user.id, 'domain.updated', b, d.id);
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/domains/:id', async (req) => {
    const d = await requireDomain(req, req.params.id, 'admin');
    await audit(d.org_id, req.user.id, 'domain.deleted', { hostname: d.hostname });
    await q('DELETE FROM domains WHERE id=$1', [d.id]);
    invalidateDomainCache(d.public_key);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/domains/:id/rotate-key', async (req) => {
    const d = await requireDomain(req, req.params.id, 'admin');
    const row = await one<{ public_key: string }>('UPDATE domains SET public_key=$2, updated_at=now() WHERE id=$1 RETURNING public_key', [d.id, newPublicKey()]);
    invalidateDomainCache(d.public_key);
    await audit(d.org_id, req.user.id, 'domain.key_rotated', {}, d.id);
    return { publicKey: row!.public_key, install: installSnippet(row!.public_key) };
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id/overview', async (req) => {
    const d = await requireDomain(req, req.params.id);
    const compliance = await complianceReport(d.id);
    const lastScan = await one('SELECT id, status, finished_at, pages_scanned, cookies_found, new_items FROM scans WHERE domain_id=$1 ORDER BY queued_at DESC LIMIT 1', [d.id]);
    const byCategory = await q('SELECT category, count(*)::int AS count FROM domain_cookies WHERE domain_id=$1 GROUP BY category', [d.id]);
    const banner = await one('SELECT version, published_at FROM banner_configs WHERE domain_id=$1 AND status=$2', [d.id, 'published']);
    return { domain: { ...d, install: installSnippet(d.public_key) }, compliance, lastScan, byCategory, banner };
  });
}
