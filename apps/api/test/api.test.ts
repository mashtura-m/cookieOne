import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';
import { pool } from '../src/db';
import { migrate } from '../src/migrate';
import { seedLibrary } from '../src/seed';
import { csvCell } from '../src/routes/consents';

let app: FastifyInstance;
let token = '';
let orgId = '';
let domainId = '';
let publicKey = '';

const auth = () => ({ authorization: `Bearer ${token}` });
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = auth()) {
  const res = await app.inject({ method, url, payload: payload as object, headers });
  return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body, headers: res.headers };
}

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(() => {});
  await seedLibrary(() => {});
  app = await buildServer({ logger: false });
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('auth', () => {
  it('registers, rejects duplicates and logs in', async () => {
    const r = await call('POST', '/api/auth/register', { name: 'Ada Admin', email: 'ada@example.com', password: 'correct-horse', orgName: 'Acme' }, {});
    expect(r.status).toBe(200);
    token = r.body.token;
    orgId = r.body.orgs[0].id;
    expect(r.body.orgs[0].role).toBe('owner');
    expect((await call('POST', '/api/auth/register', { name: 'x', email: 'ADA@example.com', password: 'correct-horse' }, {})).status).toBe(409);
    expect((await call('POST', '/api/auth/login', { email: 'ada@example.com', password: 'wrong-pass' }, {})).status).toBe(401);
    const ok = await call('POST', '/api/auth/login', { email: 'ada@example.com', password: 'correct-horse' }, {});
    expect(ok.status).toBe(200);
    expect((await call('GET', '/api/me')).body.orgs).toHaveLength(1);
    expect((await call('GET', '/api/me', undefined, {})).status).toBe(401);
  });
});

describe('domains', () => {
  it('creates a domain with defaults', async () => {
    const r = await call('POST', `/api/orgs/${orgId}/domains`, { hostname: 'https://www.Shop.example.com/path' });
    expect(r.status).toBe(200);
    expect(r.body.hostname).toBe('www.shop.example.com');
    expect(r.body.install.html).toContain(`/v1/cmp/${r.body.public_key}/cmp.js`);
    domainId = r.body.id;
    publicKey = r.body.public_key;
    expect((await call('GET', `/api/domains/${domainId}/geo-rules`)).body).toHaveLength(4);
    const cookies = (await call('GET', `/api/domains/${domainId}/cookies`)).body;
    expect(cookies.map((c: { name: string }) => c.name)).toEqual(['cf_consent']);
    expect((await call('POST', `/api/orgs/${orgId}/domains`, { hostname: 'www.shop.example.com' })).status).toBe(409);
    expect((await call('POST', `/api/orgs/${orgId}/domains`, { hostname: 'not a host' })).status).toBe(400);
  });

  it('updates settings and reports compliance', async () => {
    const r = await call('PATCH', `/api/domains/${domainId}`, { privacyPolicyUrl: 'https://shop.example.com/privacy', consentExpiryDays: 180 });
    expect(r.body.consent_expiry_days).toBe(180);
    const o = await call('GET', `/api/domains/${domainId}/overview`);
    const checks = Object.fromEntries(o.body.compliance.checks.map((c: { id: string; passed: boolean }) => [c.id, c.passed]));
    expect(checks).toMatchObject({ policy: true, published: true, reject_all: true, installed: false, recent_scan: false });
  });
});

describe('cookies & scripts', () => {
  it('prefills manual cookies from the library and lets editors override', async () => {
    const r = await call('POST', `/api/domains/${domainId}/cookies`, { name: '_ga_ABC123' });
    expect(r.body).toMatchObject({ category: 'statistics', vendor: 'Google Analytics', source: 'manual' });
    const p = await call('PATCH', `/api/cookies/${r.body.id}`, { category: 'marketing', purpose: 'Custom purpose' });
    expect(p.body).toMatchObject({ category: 'marketing', purpose: 'Custom purpose', is_overridden: true });
    const s = await call('POST', `/api/domains/${domainId}/scripts`, { urlPattern: 'tracker.shop.example.com', category: 'marketing', vendor: 'In-house' });
    expect(s.status).toBe(200);
  });
});

describe('banner', () => {
  it('edits a draft, previews it and publishes a new version', async () => {
    const g = await call('GET', `/api/domains/${domainId}/banner`);
    expect(g.body.published.version).toBe(1);
    expect(g.body.draft.version).toBe(2);
    const draft = g.body.draft;
    const put = await call('PUT', `/api/domains/${domainId}/banner`, {
      layout: 'bar', position: 'bottom', theme: { ...draft.theme, primary: '#ff0000' },
      texts: { en: { title: 'Cookies here' } }, languages: ['en', 'de'], defaultLanguage: 'en',
      showRejectAll: true, showFloatingButton: false, customCss: '',
    });
    expect(put.status).toBe(200);
    const bad = await call('PUT', `/api/domains/${domainId}/banner`, { ...put.body, defaultLanguage: 'fr' });
    expect(bad.status).toBe(400);
    const preview = await call('GET', `/api/domains/${domainId}/banner/preview-config?country=US&region=CA`);
    expect(preview.body).toMatchObject({ preview: true, regulation: 'ccpa', model: 'opt_out', bannerVersion: 2 });
    expect(preview.body.banner.theme.primary).toBe('#ff0000');
    const pub = await call('POST', `/api/domains/${domainId}/banner/publish`);
    expect(pub.body).toMatchObject({ version: 2, status: 'published' });
    expect((await call('POST', `/api/domains/${domainId}/banner/publish`)).status).toBe(400);
    expect((await call('GET', `/api/domains/${domainId}/banner/versions`)).body.map((v: { status: string }) => v.status)).toEqual(['published', 'archived']);
  });

  it('replaces geo rules and validates region codes', async () => {
    const rules = (await call('GET', `/api/domains/${domainId}/geo-rules`)).body;
    expect((await call('PUT', `/api/domains/${domainId}/geo-rules`, [{ ...rules[0], regions: ['Germany'] }])).status).toBe(400);
    const r = await call('PUT', `/api/domains/${domainId}/geo-rules`, rules.map((x: { id?: string }) => ({ ...x, id: undefined })));
    expect(r.body).toHaveLength(4);
  });
});

describe('public embed endpoints', () => {
  it('serves cmp.js with the geo-specific config inlined', async () => {
    const de = await app.inject({ method: 'GET', url: `/v1/cmp/${publicKey}/cmp.js`, headers: { 'cf-ipcountry': 'DE' } });
    expect(de.statusCode).toBe(200);
    expect(de.headers['content-type']).toContain('javascript');
    const cfg = JSON.parse(de.body.slice('window.__CF_CONFIG__='.length, de.body.indexOf(';\n')));
    expect(cfg).toMatchObject({ regulation: 'gdpr', model: 'opt_in', bannerVersion: 2, apiBase: 'https://api.test', consentExpiryDays: 180 });
    expect(cfg.banner.texts.en.title).toBe('Cookies here');
    expect(cfg.cookies.marketing.map((c: { name: string }) => c.name)).toContain('_ga_ABC123');
    expect(cfg.blocking.find((b: { pattern: string }) => b.pattern === 'tracker.shop.example.com').category).toBe('marketing');
    expect(cfg.blocking.some((b: { pattern: string }) => b.pattern === 'connect.facebook.net')).toBe(true);
    const ca = await app.inject({ method: 'GET', url: `/v1/cmp/${publicKey}/config.json`, headers: { 'cf-ipcountry': 'US', 'cf-region-code': 'CA' } });
    expect(ca.json()).toMatchObject({ regulation: 'ccpa', model: 'opt_out' });
    const missing = await app.inject({ method: 'GET', url: '/v1/cmp/doesnotexist/cmp.js' });
    expect(missing.statusCode).toBe(404);
  });

  it('records consents and impressions from allowed origins only', async () => {
    const consentId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const payload = JSON.stringify({ domainKey: publicKey, consentId, action: 'reject_all', choices: { preferences: false, statistics: false, marketing: false }, bannerVersion: 2, regulation: 'gdpr', url: 'https://shop.example.com/', gpc: false });
    const ok = await app.inject({ method: 'POST', url: '/v1/consent', payload, headers: { 'content-type': 'text/plain', origin: 'https://shop.example.com', 'cf-ipcountry': 'FR', 'x-forwarded-for': '203.0.113.77' } });
    expect(ok.statusCode).toBe(201);
    const evil = await app.inject({ method: 'POST', url: '/v1/consent', payload, headers: { 'content-type': 'text/plain', origin: 'https://evil.example.org' } });
    expect(evil.statusCode).toBe(403);
    const bad = await app.inject({ method: 'POST', url: '/v1/consent', payload: '{"domainKey":"x"}', headers: { 'content-type': 'text/plain' } });
    expect(bad.statusCode).toBe(400);
    const accept = JSON.parse(payload);
    accept.action = 'accept_all';
    accept.choices = { preferences: true, statistics: true, marketing: true };
    accept.consentId = '9b2f3c1e-1111-4a2b-8c3d-123456789abc';
    await app.inject({ method: 'POST', url: '/v1/consent', payload: JSON.stringify(accept), headers: { 'content-type': 'text/plain', origin: 'https://www.shop.example.com', 'cf-ipcountry': 'DE' } });
    for (let i = 0; i < 4; i++) await app.inject({ method: 'POST', url: `/v1/cmp/${publicKey}/impression`, headers: { origin: 'https://shop.example.com', 'cf-ipcountry': 'FR' } });

    const list = await call('GET', `/api/domains/${domainId}/consents`);
    expect(list.body.total).toBe(2);
    const fr = list.body.rows.find((r: { country: string }) => r.country === 'FR');
    expect(fr).toMatchObject({ action: 'reject_all', ip_truncated: '203.0.113.0', consent_id: consentId });
    const byId = await call('GET', `/api/domains/${domainId}/consents?q=${consentId}`);
    expect(byId.body.total).toBe(1);
    const visitor = await app.inject({ method: 'GET', url: `/v1/cmp/${publicKey}/consents/${consentId}` });
    expect(visitor.json()).toHaveLength(1);

    const stats = await call('GET', `/api/domains/${domainId}/stats?days=7`);
    expect(stats.body.totals).toMatchObject({ impressions: 4, accept_all: 1, reject_all: 1 });
    expect(stats.body.rates.acceptAll).toBe(0.5);
    expect(stats.body.daily).toHaveLength(7);

    const csv = await call('GET', `/api/domains/${domainId}/consents/export.csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = (csv.body as string).trim().split('\n');
    expect(lines[0]).toContain('consent_id');
    expect(lines).toHaveLength(3);

    const overview = await call('GET', `/api/domains/${domainId}/overview`);
    expect(overview.body.compliance.checks.find((c: { id: string }) => c.id === 'installed').passed).toBe(true);
  });
});

describe('scans', () => {
  it('queues one scan at a time', async () => {
    const s = await call('POST', `/api/domains/${domainId}/scans`);
    expect(s.body.status).toBe('queued');
    expect((await call('POST', `/api/domains/${domainId}/scans`)).status).toBe(409);
    const detail = await call('GET', `/api/scans/${s.body.id}`);
    expect(detail.body).toMatchObject({ status: 'queued', pages: [], findings: [] });
  });
});

describe('team & permissions', () => {
  it('invites a viewer who can read but not edit, and hides other orgs', async () => {
    const inv = await call('POST', `/api/orgs/${orgId}/invitations`, { email: 'vic@example.com', role: 'viewer' });
    expect(inv.body.inviteUrl).toMatch(/\/invite\/.+/);
    const inviteToken = inv.body.inviteUrl.split('/invite/')[1];
    const acc = await call('POST', '/api/auth/accept-invite', { token: inviteToken, name: 'Vic Viewer', password: 'viewer-pass-1' }, {});
    expect(acc.status).toBe(200);
    const viewer = { authorization: `Bearer ${acc.body.token}` };
    expect((await call('GET', `/api/domains/${domainId}/cookies`, undefined, viewer)).status).toBe(200);
    expect((await call('POST', `/api/domains/${domainId}/scans`, undefined, viewer)).status).toBe(403);
    expect((await call('PATCH', `/api/domains/${domainId}`, { consentExpiryDays: 10 }, viewer)).status).toBe(403);
    expect((await call('POST', '/api/auth/accept-invite', { token: inviteToken, name: 'x', password: 'whatever-1' }, {})).status).toBe(400);

    const other = await call('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'eve-password' }, {});
    const eve = { authorization: `Bearer ${other.body.token}` };
    expect((await call('GET', `/api/domains/${domainId}`, undefined, eve)).status).toBe(404);
    expect((await call('GET', `/api/orgs/${orgId}/domains`, undefined, eve)).status).toBe(404);

    const members = await call('GET', `/api/orgs/${orgId}/members`);
    expect(members.body.members).toHaveLength(2);
    const me = members.body.members.find((m: { email: string }) => m.email === 'ada@example.com');
    expect((await call('PATCH', `/api/orgs/${orgId}/members/${me.id}`, { role: 'editor' })).status).toBe(400);
    const audit = await call('GET', `/api/orgs/${orgId}/audit`);
    expect(audit.body.some((a: { action: string }) => a.action === 'banner.published')).toBe(true);
  });
});

describe('csv', () => {
  it('escapes cells and neutralises formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(null)).toBe('');
  });
});
