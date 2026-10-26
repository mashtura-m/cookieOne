import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { DEFAULT_GEO_RULES, DEFAULT_THEME } from '@consentflow/shared';

export function newPublicKey(): string {
  return randomBytes(12).toString('base64url');
}

/** Normalises "https://www.Example.com/path" to "www.example.com". */
export function normalizeHostname(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z]+:\/\//.test(s)) s = 'https://' + s;
  try {
    const host = new URL(s).hostname;
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') && host !== 'localhost') return null;
    return host;
  } catch {
    return null;
  }
}

/** Every new domain starts with a published default banner, default geo rules and the consent cookie declared. */
export async function setupDomain(c: pg.PoolClient, domainId: string, userId: string | null): Promise<void> {
  await c.query(
    `INSERT INTO banner_configs (domain_id, version, status, theme, texts, created_by, published_at)
     VALUES ($1, 1, 'published', $2, '{}', $3, now())`,
    [domainId, DEFAULT_THEME, userId],
  );
  for (const r of DEFAULT_GEO_RULES) {
    await c.query(
      `INSERT INTO geo_rules (domain_id, name, regulation, model, regions, honor_gpc, priority, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [domainId, r.name, r.regulation, r.model, r.regions, r.honorGpc, r.priority, r.enabled],
    );
  }
  await c.query(
    `INSERT INTO domain_cookies (domain_id, kind, name, provider_domain, category, vendor, purpose, retention, source, is_overridden)
     VALUES ($1, 'cookie', 'cf_consent', '', 'necessary', 'ConsentFlow', 'Stores the visitor''s cookie consent choices.', '1 year', 'library', true)`,
    [domainId],
  );
}
