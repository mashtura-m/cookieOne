import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/consentflow',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  /** Public URL of this API, embedded in cmp.js so the banner knows where to send consents. */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  dashboardUrl: (process.env.DASHBOARD_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  cmpBundlePath: process.env.CMP_BUNDLE_PATH ?? resolve(repoRoot, 'packages/banner/dist/cmp.js'),
  migrationsDir: process.env.MIGRATIONS_DIR ?? resolve(repoRoot, 'db/migrations'),
  seedDir: process.env.SEED_DIR ?? resolve(repoRoot, 'db/seed'),
  /** Lets ?cf_country=DE&cf_region=CA override geo-IP. Useful in development and QA. */
  allowGeoOverride: bool(process.env.ALLOW_GEO_OVERRIDE, process.env.NODE_ENV !== 'production'),
  /** Country used when no geo header is present (e.g. local development without a CDN). */
  defaultCountry: process.env.DEFAULT_COUNTRY || null,
  /** Reject consent posts whose Origin is not one of the domain's hostnames. */
  strictOrigin: bool(process.env.STRICT_ORIGIN, true),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
