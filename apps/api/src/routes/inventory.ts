import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { categorizeCookie, type LibraryCookie } from '@consentflow/shared';
import { audit, requireAuth, requireDomain } from '../auth';
import { one, q } from '../db';
import { conflict, notFound } from '../errors';
import { invalidateDomainCache } from '../lib/public-config';

const Category = z.enum(['necessary', 'preferences', 'statistics', 'marketing', 'unclassified']);

const CookieInput = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['cookie', 'local_storage', 'session_storage', 'pixel']).default('cookie'),
  providerDomain: z.string().trim().max(253).default(''),
  category: Category.optional(),
  vendor: z.string().trim().max(200).nullable().optional(),
  purpose: z.string().trim().max(1000).nullable().optional(),
  retention: z.string().trim().max(100).nullable().optional(),
});
const CookiePatch = CookieInput.partial().omit({ kind: true });

const ScriptInput = z.object({
  urlPattern: z.string().trim().min(3).max(500),
  category: Category,
  vendor: z.string().trim().max(200).nullable().optional(),
});

export async function loadCookieLibrary(): Promise<LibraryCookie[]> {
  const rows = await q<{ id: number; name_pattern: string; is_regex: boolean; vendor: string; provider_domain: string | null; category: LibraryCookie['category']; purpose: string; retention: string | null }>(
    'SELECT * FROM cookie_library',
  );
  return rows.map((r) => ({ id: r.id, namePattern: r.name_pattern, isRegex: r.is_regex, vendor: r.vendor, providerDomain: r.provider_domain, category: r.category, purpose: r.purpose, retention: r.retention }));
}

export async function inventoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { id: string } }>('/api/domains/:id/cookies', async (req) => {
    const d = await requireDomain(req, req.params.id);
    return q('SELECT * FROM domain_cookies WHERE domain_id=$1 ORDER BY category, provider_domain, name', [d.id]);
  });

  app.post<{ Params: { id: string } }>('/api/domains/:id/cookies', async (req) => {
    const d = await requireDomain(req, req.params.id, 'editor');
    const b = CookieInput.parse(req.body);
    const exists = await one('SELECT 1 FROM domain_cookies WHERE domain_id=$1 AND kind=$2 AND name=$3 AND provider_domain=$4', [d.id, b.kind, b.name, b.providerDomain]);
    if (exists) throw conflict(`${b.name} is already declared`);
    // Pre-fill from the library when the admin leaves fields empty.
    const match = categorizeCookie(b.name, b.providerDomain, await loadCookieLibrary());
    const row = await one(
      `INSERT INTO domain_cookies (domain_id, kind, name, provider_domain, category, vendor, purpose, retention, library_id, source, is_overridden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',true) RETURNING *`,
      [d.id, b.kind, b.name, b.providerDomain, b.category ?? match?.category ?? 'unclassified', b.vendor ?? match?.vendor ?? null, b.purpose ?? match?.purpose ?? null, b.retention ?? match?.retention ?? null, match?.libraryId ?? null],
    );
    invalidateDomainCache(d.public_key);
    await audit(d.org_id, req.user.id, 'cookie.added', { name: b.name }, d.id);
    return row;
  });

  app.patch<{ Params: { cookieId: string } }>('/api/cookies/:cookieId', async (req) => {
    const existing = await one<{ domain_id: string }>('SELECT domain_id FROM domain_cookies WHERE id=$1', [req.params.cookieId]);
    if (!existing) throw notFound('Cookie');
    const d = await requireDomain(req, existing.domain_id, 'editor');
    const b = CookiePatch.parse(req.body);
    const row = await one(
      `UPDATE domain_cookies SET
         name = COALESCE($2, name), provider_domain = COALESCE($3, provider_domain), category = COALESCE($4, category),
         vendor = CASE WHEN $5::boolean THEN $6 ELSE vendor END,
         purpose = CASE WHEN $7::boolean THEN $8 ELSE purpose END,
         retention = CASE WHEN $9::boolean THEN $10 ELSE retention END,
         is_overridden = true
       WHERE id=$1 RETURNING *`,
      [req.params.cookieId, b.name ?? null, b.providerDomain ?? null, b.category ?? null, b.vendor !== undefined, b.vendor ?? null, b.purpose !== undefined, b.purpose ?? null, b.retention !== undefined, b.retention ?? null],
    );
    invalidateDomainCache(d.public_key);
    await audit(d.org_id, req.user.id, 'cookie.updated', { id: req.params.cookieId, ...b }, d.id);
    return row;
  });

  app.delete<{ Params: { cookieId: string } }>('/api/cookies/:cookieId', async (req) => {
    const existing = await one<{ domain_id: string; name: string }>('SELECT domain_id, name FROM domain_cookies WHERE id=$1', [req.params.cookieId]);
    if (!existing) throw notFound('Cookie');
    const d = await requireDomain(req, existing.domain_id, 'editor');
    await q('DELETE FROM domain_cookies WHERE id=$1', [req.params.cookieId]);
    invalidateDomainCache(d.public_key);
    await audit(d.org_id, req.user.id, 'cookie.deleted', { name: existing.name }, d.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id/scripts', async (req) => {
    const d = await requireDomain(req, req.params.id);
    return q('SELECT * FROM domain_scripts WHERE domain_id=$1 ORDER BY category, url_pattern', [d.id]);
  });

  app.post<{ Params: { id: string } }>('/api/domains/:id/scripts', async (req) => {
    const d = await requireDomain(req, req.params.id, 'editor');
    const b = ScriptInput.parse(req.body);
    const row = await one(
      `INSERT INTO domain_scripts (domain_id, url_pattern, category, vendor, source, is_overridden) VALUES ($1,$2,$3,$4,'manual',true)
       ON CONFLICT (domain_id, url_pattern) DO UPDATE SET category=EXCLUDED.category, vendor=EXCLUDED.vendor, is_overridden=true RETURNING *`,
      [d.id, b.urlPattern, b.category, b.vendor ?? null],
    );
    invalidateDomainCache(d.public_key);
    await audit(d.org_id, req.user.id, 'script.saved', b, d.id);
    return row;
  });

  app.patch<{ Params: { scriptId: string } }>('/api/scripts/:scriptId', async (req) => {
    const existing = await one<{ domain_id: string }>('SELECT domain_id FROM domain_scripts WHERE id=$1', [req.params.scriptId]);
    if (!existing) throw notFound('Script');
    const d = await requireDomain(req, existing.domain_id, 'editor');
    const b = ScriptInput.partial().parse(req.body);
    const row = await one(
      `UPDATE domain_scripts SET url_pattern=COALESCE($2,url_pattern), category=COALESCE($3,category), vendor=COALESCE($4,vendor), is_overridden=true WHERE id=$1 RETURNING *`,
      [req.params.scriptId, b.urlPattern ?? null, b.category ?? null, b.vendor ?? null],
    );
    invalidateDomainCache(d.public_key);
    return row;
  });

  app.delete<{ Params: { scriptId: string } }>('/api/scripts/:scriptId', async (req) => {
    const existing = await one<{ domain_id: string }>('SELECT domain_id FROM domain_scripts WHERE id=$1', [req.params.scriptId]);
    if (!existing) throw notFound('Script');
    const d = await requireDomain(req, existing.domain_id, 'editor');
    await q('DELETE FROM domain_scripts WHERE id=$1', [req.params.scriptId]);
    invalidateDomainCache(d.public_key);
    return { ok: true };
  });
}
