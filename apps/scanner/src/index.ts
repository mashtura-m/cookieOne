import os from 'node:os';
import pg from 'pg';
import {
  categorizeCookie, categorizeScript, describeRetention, normalizeDomain,
  type LibraryCookie, type LibraryScript, type CategoryOrUnclassified,
} from '@consentflow/shared';
import { crawl, type RawFinding } from './crawl';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/consentflow';
const POLL_MS = Number(process.env.SCANNER_POLL_MS ?? 5000);
const STALE_MINUTES = Number(process.env.SCANNER_STALE_MINUTES ?? 30);
const WORKER_ID = `${os.hostname()}-${process.pid}`;
const ONCE = process.argv.includes('--once');

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[scanner]', ...a);

interface ScanJob {
  id: string;
  domain_id: string;
  page_limit: number;
  hostname: string;
  extra_hostnames: string[];
}

/** Claims the oldest queued scan. SKIP LOCKED lets several workers share the queue safely. */
async function claim(): Promise<ScanJob | null> {
  const { rows } = await pool.query<ScanJob>(
    `UPDATE scans s SET status='running', started_at=now(), locked_by=$1
     FROM domains d
     WHERE s.id = (SELECT id FROM scans WHERE status='queued' ORDER BY queued_at FOR UPDATE SKIP LOCKED LIMIT 1)
       AND d.id = s.domain_id
     RETURNING s.id, s.domain_id, s.page_limit, d.hostname, d.extra_hostnames`,
    [WORKER_ID],
  );
  return rows[0] ?? null;
}

/** Re-queue scans whose worker died, and enqueue scheduled scans that are due. */
async function housekeeping(): Promise<void> {
  await pool.query(
    `UPDATE scans SET status='failed', error='Scanner stopped responding', finished_at=now()
     WHERE status='running' AND started_at < now() - ($1 || ' minutes')::interval`,
    [String(STALE_MINUTES)],
  );
  const { rowCount } = await pool.query(
    `INSERT INTO scans (domain_id, trigger, page_limit)
     SELECT d.id, 'scheduled', d.scan_page_limit FROM domains d
     WHERE d.scan_frequency <> 'off'
       AND NOT EXISTS (SELECT 1 FROM scans s WHERE s.domain_id=d.id AND s.status IN ('queued','running'))
       AND NOT EXISTS (
         SELECT 1 FROM scans s WHERE s.domain_id=d.id AND s.queued_at >
           now() - CASE d.scan_frequency WHEN 'weekly' THEN interval '7 days' ELSE interval '30 days' END)`,
  );
  if (rowCount) log(`scheduled ${rowCount} scan(s)`);
}

async function loadLibrary(): Promise<{ cookies: LibraryCookie[]; scripts: LibraryScript[] }> {
  const c = await pool.query('SELECT * FROM cookie_library');
  const s = await pool.query('SELECT vendor, url_pattern, category FROM vendor_scripts');
  return {
    cookies: c.rows.map((r) => ({ id: r.id, namePattern: r.name_pattern, isRegex: r.is_regex, vendor: r.vendor, providerDomain: r.provider_domain, category: r.category, purpose: r.purpose, retention: r.retention })),
    scripts: s.rows.map((r) => ({ vendor: r.vendor, urlPattern: r.url_pattern, category: r.category })),
  };
}

interface Classified extends RawFinding {
  category: CategoryOrUnclassified;
  vendor: string | null;
  purpose: string | null;
  retention: string | null;
  libraryId: number | null;
  /** Blocking pattern for scripts/iframes: the library pattern when known, otherwise the host. */
  pattern: string | null;
}

export function classify(findings: RawFinding[], lib: { cookies: LibraryCookie[]; scripts: LibraryScript[] }, siteHost: string): Classified[] {
  return findings.map((f) => {
    if (f.kind === 'script' || f.kind === 'iframe' || f.kind === 'pixel') {
      const m = categorizeScript(f.name, lib.scripts);
      return { ...f, category: m?.category ?? 'unclassified', vendor: m?.vendor ?? null, purpose: null, retention: null, libraryId: null, pattern: m?.urlPattern ?? scriptPattern(f.name) };
    }
    const m = categorizeCookie(f.name, f.providerDomain || siteHost, lib.cookies);
    const expires = typeof f.attributes.expires === 'number' ? (f.attributes.expires as number) : undefined;
    return {
      ...f,
      category: m?.category ?? (f.name === 'cf_consent' ? 'necessary' : 'unclassified'),
      vendor: m?.vendor ?? null,
      purpose: m?.purpose ?? null,
      retention: f.kind === 'cookie' ? describeRetention(expires) : m?.retention ?? 'Persistent',
      libraryId: m?.libraryId ?? null,
      pattern: null,
    };
  });
}

/** Scripts are blocked by host, which also covers versioned or cache-busted file names. */
function scriptPattern(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url;
  }
}

async function runJob(job: ScanJob): Promise<void> {
  log(`scan ${job.id} started for ${job.hostname} (limit ${job.page_limit})`);
  const startUrl = process.env.SCANNER_URL_OVERRIDE ?? `https://${job.hostname}/`;
  const allowedHosts = [job.hostname, ...job.extra_hostnames, ...(process.env.SCANNER_URL_OVERRIDE ? [new URL(startUrl).hostname] : [])];
  const lib = await loadLibrary();
  const result = await crawl({
    startUrl,
    allowedHosts,
    pageLimit: job.page_limit,
    executablePath: process.env.CHROMIUM_PATH,
    onPage: async (p, i) => {
      await pool.query('INSERT INTO scan_pages (scan_id, url, status_code, error) VALUES ($1,$2,$3,$4)', [job.id, p.url, p.statusCode, p.error]);
      await pool.query('UPDATE scans SET pages_scanned=$2 WHERE id=$1', [job.id, i]);
    },
  });
  const okPages = result.pages.filter((p) => !p.error && (p.statusCode ?? 0) < 400).length;
  if (okPages === 0) throw new Error(result.pages[0]?.error ?? `Could not load ${startUrl}`);

  const classified = classify(result.findings, lib, normalizeDomain(job.hostname));
  const client = await pool.connect();
  let newItems = 0;
  try {
    await client.query('BEGIN');
    for (const f of classified) {
      await client.query(
        `INSERT INTO scan_findings (scan_id, kind, name, provider_domain, first_seen_url, category, vendor, attributes, set_before_consent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT DO NOTHING`,
        [job.id, f.kind, f.name.slice(0, 1000), f.providerDomain, f.firstSeenUrl, f.category, f.vendor, f.attributes],
      );
      if (f.kind === 'cookie' || f.kind === 'local_storage' || f.kind === 'session_storage') {
        const r = await client.query(
          `INSERT INTO domain_cookies (domain_id, kind, name, provider_domain, category, vendor, purpose, retention, library_id, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scan')
           ON CONFLICT (domain_id, kind, name, provider_domain) DO UPDATE SET
             last_seen_at = now(),
             category = CASE WHEN domain_cookies.is_overridden THEN domain_cookies.category ELSE EXCLUDED.category END,
             vendor = CASE WHEN domain_cookies.is_overridden THEN domain_cookies.vendor ELSE COALESCE(EXCLUDED.vendor, domain_cookies.vendor) END,
             purpose = CASE WHEN domain_cookies.is_overridden THEN domain_cookies.purpose ELSE COALESCE(EXCLUDED.purpose, domain_cookies.purpose) END,
             retention = CASE WHEN domain_cookies.is_overridden THEN domain_cookies.retention ELSE COALESCE(EXCLUDED.retention, domain_cookies.retention) END,
             library_id = COALESCE(EXCLUDED.library_id, domain_cookies.library_id)
           RETURNING (xmax = 0) AS inserted`,
          [job.domain_id, f.kind, f.name, f.providerDomain, f.category, f.vendor, f.purpose, f.retention, f.libraryId],
        );
        if (r.rows[0]?.inserted) newItems++;
      } else if (f.kind === 'script' || f.kind === 'iframe') {
        const r = await client.query(
          `INSERT INTO domain_scripts (domain_id, url_pattern, category, vendor, source) VALUES ($1,$2,$3,$4,'scan')
           ON CONFLICT (domain_id, url_pattern) DO UPDATE SET last_seen_at=now(),
             category = CASE WHEN domain_scripts.is_overridden THEN domain_scripts.category
                             WHEN domain_scripts.category='unclassified' THEN EXCLUDED.category ELSE domain_scripts.category END,
             vendor = COALESCE(domain_scripts.vendor, EXCLUDED.vendor)
           RETURNING (xmax = 0) AS inserted`,
          [job.domain_id, f.pattern, f.category, f.vendor],
        );
        if (r.rows[0]?.inserted) newItems++;
      }
    }
    const cookiesFound = classified.filter((f) => f.kind === 'cookie').length;
    await client.query(
      `UPDATE scans SET status='completed', finished_at=now(), pages_scanned=$2, cookies_found=$3, new_items=$4, error=NULL WHERE id=$1`,
      [job.id, result.pages.length, cookiesFound, newItems],
    );
    await client.query('COMMIT');
    log(`scan ${job.id} completed: ${result.pages.length} pages, ${cookiesFound} cookies, ${newItems} new items`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function tick(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  try {
    await runJob(job);
  } catch (err) {
    const msg = (err as Error).message.split('\n')[0].slice(0, 500);
    log(`scan ${job.id} failed: ${msg}`);
    await pool.query(`UPDATE scans SET status='failed', error=$2, finished_at=now() WHERE id=$1`, [job.id, msg]);
  }
  return true;
}

async function main() {
  log(`worker ${WORKER_ID} started`);
  if (ONCE) {
    await tick();
    await pool.end();
    return;
  }
  let lastHousekeeping = 0;
  let stopping = false;
  const stop = () => {
    stopping = true;
    log('stopping after the current scan');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  while (!stopping) {
    try {
      if (Date.now() - lastHousekeeping > 60_000) {
        await housekeeping();
        lastHousekeeping = Date.now();
      }
      const worked = await tick();
      if (!worked) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      log('loop error', (err as Error).message);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
