import type { BannerTheme, Category, GeoRule, PublicConfig, PublicCookie } from '@consentflow/shared';
import { CATEGORIES, DEFAULT_THEME, resolveRule } from '@consentflow/shared';
import { q, one } from '../db';
import { config } from '../config';

export interface BannerRow {
  id: string;
  domain_id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  layout: PublicConfig['banner']['layout'];
  position: PublicConfig['banner']['position'];
  theme: Partial<BannerTheme>;
  texts: PublicConfig['banner']['texts'];
  languages: string[];
  default_language: string;
  show_reject_all: boolean;
  show_floating_button: boolean;
  custom_css: string;
  created_at: string;
  published_at: string | null;
}

interface DomainPublic {
  id: string;
  public_key: string;
  hostname: string;
  extra_hostnames: string[];
  consent_expiry_days: number;
  privacy_policy_url: string | null;
  google_consent_mode: boolean;
  auto_block: boolean;
}

/** Data that does not depend on the visitor; cached briefly because cmp.js is requested on every page view. */
export interface DomainBundle {
  domain: DomainPublic;
  banner: BannerRow | null;
  rules: GeoRule[];
  cookies: Record<Category, PublicCookie[]>;
  blocking: { pattern: string; category: Category }[];
}

const cache = new Map<string, { at: number; value: DomainBundle | null }>();
const TTL_MS = Number(process.env.CMP_CACHE_TTL_MS ?? 30_000);

export function invalidateDomainCache(publicKey?: string): void {
  if (publicKey) cache.delete(publicKey);
  else cache.clear();
}

export async function loadRules(domainId: string): Promise<GeoRule[]> {
  const rows = await q<{ id: string; name: string; regulation: GeoRule['regulation']; model: GeoRule['model']; regions: string[]; honor_gpc: boolean; priority: number; enabled: boolean }>(
    'SELECT * FROM geo_rules WHERE domain_id=$1 ORDER BY priority DESC, created_at',
    [domainId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, regulation: r.regulation, model: r.model, regions: r.regions, honorGpc: r.honor_gpc, priority: r.priority, enabled: r.enabled }));
}

async function loadInventory(domainId: string) {
  const cookies = Object.fromEntries(CATEGORIES.map((c) => [c, [] as PublicCookie[]])) as Record<Category, PublicCookie[]>;
  const rows = await q<{ name: string; provider_domain: string; category: string; purpose: string | null; retention: string | null; kind: string }>(
    `SELECT name, provider_domain, category, purpose, retention, kind FROM domain_cookies WHERE domain_id=$1 ORDER BY category, name`,
    [domainId],
  );
  for (const r of rows) {
    // Unclassified items are listed under marketing (the strictest category) so they stay blocked.
    const cat = (r.category === 'unclassified' ? 'marketing' : r.category) as Category;
    cookies[cat].push({ name: r.name, provider: r.provider_domain, purpose: r.purpose ?? '', retention: r.retention ?? '', kind: r.kind });
  }
  const scripts = await q<{ url_pattern: string; category: string }>(
    // Unclassified scripts are not blocked automatically: blocking unknown code can break a site.
    // They show up in the dashboard for an admin to categorize.
    `SELECT url_pattern, category FROM domain_scripts WHERE domain_id=$1 AND category NOT IN ('necessary', 'unclassified')`,
    [domainId],
  );
  const lib = await q<{ url_pattern: string; category: string }>(`SELECT url_pattern, category FROM vendor_scripts WHERE category NOT IN ('necessary', 'unclassified')`);
  // Domain rules marked necessary must also stop the global library from blocking that pattern.
  const allowed = await q<{ url_pattern: string }>(`SELECT url_pattern FROM domain_scripts WHERE domain_id=$1 AND category = 'necessary'`, [domainId]);
  const seen = new Set<string>(allowed.map((a) => a.url_pattern));
  const blocking: { pattern: string; category: Category }[] = [];
  for (const s of [...scripts, ...lib]) {
    if (seen.has(s.url_pattern)) continue; // domain-specific rules win over the global library
    seen.add(s.url_pattern);
    blocking.push({ pattern: s.url_pattern, category: s.category as Category });
  }
  return { cookies, blocking };
}

export async function loadDomainBundle(publicKey: string): Promise<DomainBundle | null> {
  const hit = cache.get(publicKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const domain = await one<DomainPublic>(
    'SELECT id, public_key, hostname, extra_hostnames, consent_expiry_days, privacy_policy_url, google_consent_mode, auto_block FROM domains WHERE public_key=$1',
    [publicKey],
  );
  let value: DomainBundle | null = null;
  if (domain) {
    const banner = await one<BannerRow>(`SELECT * FROM banner_configs WHERE domain_id=$1 AND status='published'`, [domain.id]);
    const rules = await loadRules(domain.id);
    value = { domain, banner, rules, ...(await loadInventory(domain.id)) };
  }
  cache.set(publicKey, { at: Date.now(), value });
  return value;
}

export async function bundleForDomainId(domainId: string, banner: BannerRow): Promise<DomainBundle> {
  const domain = await one<DomainPublic>(
    'SELECT id, public_key, hostname, extra_hostnames, consent_expiry_days, privacy_policy_url, google_consent_mode, auto_block FROM domains WHERE id=$1',
    [domainId],
  );
  if (!domain) throw new Error('domain vanished');
  return { domain, banner, rules: await loadRules(domainId), ...(await loadInventory(domainId)) };
}

export function buildPublicConfig(b: DomainBundle, geo: { country: string | null; region: string | null }, preview = false): PublicConfig {
  const rule = resolveRule(b.rules, geo.country, geo.region);
  const banner = b.banner;
  return {
    domainKey: b.domain.public_key,
    apiBase: config.publicApiUrl,
    bannerVersion: banner?.version ?? 0,
    regulation: rule.regulation,
    model: rule.model,
    honorGpc: rule.honorGpc,
    country: geo.country,
    region: geo.region,
    consentExpiryDays: b.domain.consent_expiry_days,
    googleConsentMode: b.domain.google_consent_mode,
    autoBlock: b.domain.auto_block,
    privacyPolicyUrl: b.domain.privacy_policy_url,
    banner: {
      layout: banner?.layout ?? 'box',
      position: banner?.position ?? 'bottom-left',
      theme: { ...DEFAULT_THEME, ...(banner?.theme ?? {}) },
      texts: banner?.texts ?? {},
      languages: banner?.languages?.length ? banner.languages : ['en'],
      defaultLanguage: banner?.default_language ?? 'en',
      showRejectAll: banner?.show_reject_all ?? true,
      showFloatingButton: banner?.show_floating_button ?? true,
      customCss: banner?.custom_css ?? '',
    },
    cookies: b.cookies,
    blocking: b.blocking,
    ...(preview ? { preview: true } : {}),
  };
}

/** JSON that is safe to inline inside a <script> or a JS file. */
export function inlineJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
