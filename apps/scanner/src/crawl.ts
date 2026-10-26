import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface RawCookie {
  name: string;
  domain: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  pageUrl: string;
}

export interface RawFinding {
  kind: 'cookie' | 'local_storage' | 'session_storage' | 'script' | 'iframe' | 'pixel';
  name: string;
  providerDomain: string;
  firstSeenUrl: string;
  attributes: Record<string, unknown>;
}

export interface PageResult {
  url: string;
  statusCode: number | null;
  error: string | null;
}

export interface CrawlResult {
  pages: PageResult[];
  findings: RawFinding[];
}

export interface CrawlOptions {
  startUrl: string;
  allowedHosts: string[];
  pageLimit: number;
  navigationTimeoutMs?: number;
  settleMs?: number;
  userAgent?: string;
  onPage?: (p: PageResult, index: number) => void | Promise<void>;
  executablePath?: string;
}

const STORAGE_PROBE = `(() => {
  const keys = (s) => { const out = []; for (let i = 0; i < s.length; i++) out.push(s.key(i)); return out; };
  try { return { local: keys(localStorage), session: keys(sessionStorage) }; } catch (e) { return { local: [], session: [] }; }
})()`;

const SKIP_EXT = /\.(pdf|zip|png|jpe?g|gif|webp|svg|ico|mp4|mp3|webm|docx?|xlsx?|pptx?|csv|xml|json|rss|txt|woff2?|ttf|css|js)(\?|$)/i;

function sameSite(host: string, allowed: string[]): boolean {
  const h = host.replace(/^www\./, '').toLowerCase();
  return allowed.some((a) => {
    const x = a.replace(/^www\./, '').toLowerCase();
    return h === x || h.endsWith('.' + x);
  });
}

export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    // Drop common tracking parameters so the same page is not crawled twice.
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid|mc_)/i.test(p)) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return null;
  }
}

async function sitemapUrls(context: BrowserContext, origin: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const queue = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seen = new Set<string>();
  while (queue.length && out.length < limit && seen.size < 10) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await context.request.get(url, { timeout: 10000 });
      if (!res.ok()) continue;
      const xml = await res.text();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const loc = m[1].replace(/&amp;/g, '&');
        if (/sitemap[^/]*\.xml/i.test(loc)) queue.push(loc);
        else out.push(loc);
        if (out.length >= limit) break;
      }
    } catch {
      /* no sitemap */
    }
  }
  return out;
}

/**
 * Visits pages like a first-time visitor who has not interacted with any consent banner,
 * and records every cookie, storage key, script, iframe and tracking pixel it sees.
 */
export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const browser: Browser = await chromium.launch({ headless: true, executablePath: opts.executablePath || undefined });
  const findings = new Map<string, RawFinding>();
  const pages: PageResult[] = [];
  const add = (f: RawFinding) => {
    const key = `${f.kind}|${f.name}|${f.providerDomain}`;
    if (!findings.has(key)) findings.set(key, f);
  };
  try {
    const context = await browser.newContext({
      userAgent: opts.userAgent ?? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ConsentFlowScanner/0.1',
      viewport: { width: 1366, height: 900 },
      ignoreHTTPSErrors: true,
    });
    let currentUrl = opts.startUrl;
    context.on('request', (req) => {
      const type = req.resourceType();
      const url = req.url();
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        return;
      }
      // First-party resources are the site's own code; only third parties are trackers.
      if (sameSite(host, opts.allowedHosts)) return;
      const path = new URL(url).pathname;
      if (type === 'script') add({ kind: 'script', name: url.split(/[?#]/)[0], providerDomain: host, firstSeenUrl: currentUrl, attributes: {} });
      else if (type === 'image' && /(\/tr\/?$|pixel|collect|track|beacon|\/p\.gif|\/i\.gif)/i.test(path)) {
        add({ kind: 'pixel', name: `${host}${path}`, providerDomain: host, firstSeenUrl: currentUrl, attributes: {} });
      }
    });

    const origin = new URL(opts.startUrl).origin;
    const queue: string[] = [normalizeUrl(opts.startUrl)!];
    const seen = new Set<string>(queue);
    for (const u of await sitemapUrls(context, origin, opts.pageLimit * 2)) {
      const n = normalizeUrl(u);
      if (n && !seen.has(n) && sameSite(new URL(n).hostname, opts.allowedHosts)) {
        seen.add(n);
        queue.push(n);
      }
    }

    const page: Page = await context.newPage();
    page.setDefaultNavigationTimeout(opts.navigationTimeoutMs ?? 30000);
    while (queue.length && pages.length < opts.pageLimit) {
      const url = queue.shift()!;
      currentUrl = url;
      const result: PageResult = { url, statusCode: null, error: null };
      try {
        const res = await page.goto(url, { waitUntil: 'load' });
        result.statusCode = res?.status() ?? null;
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(opts.settleMs ?? 1500);
        // Scroll to trigger lazy-loaded embeds and trackers.
        await page.evaluate(() => window.scrollTo(0, document.body ? document.body.scrollHeight : 0)).catch(() => {});
        await page.waitForTimeout(500);

        // Passed as a string: bundlers may inject helpers (e.g. __name) that do not exist in the page.
        const storage = await page
          .evaluate<{ local: string[]; session: string[] }>(STORAGE_PROBE)
          .catch(() => ({ local: [] as string[], session: [] as string[] }));
        for (const k of storage.local) add({ kind: 'local_storage', name: k, providerDomain: '', firstSeenUrl: url, attributes: {} });
        for (const k of storage.session) add({ kind: 'session_storage', name: k, providerDomain: '', firstSeenUrl: url, attributes: {} });

        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          const fu = frame.url();
          if (!/^https?:/.test(fu)) continue;
          const fh = new URL(fu).hostname;
          if (!sameSite(fh, opts.allowedHosts)) add({ kind: 'iframe', name: fu.split('?')[0], providerDomain: fh, firstSeenUrl: url, attributes: {} });
        }

        if (pages.length + queue.length < opts.pageLimit * 3) {
          const links = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);
          for (const l of links) {
            const n = normalizeUrl(l, url);
            if (!n || seen.has(n) || SKIP_EXT.test(n)) continue;
            if (!sameSite(new URL(n).hostname, opts.allowedHosts)) continue;
            seen.add(n);
            queue.push(n);
          }
        }
      } catch (err) {
        result.error = (err as Error).message.split('\n')[0].slice(0, 300);
      }
      // Cookies accumulate across the visit, like a real visitor's browser.
      for (const c of await context.cookies()) {
        const providerDomain = c.domain.replace(/^\./, '');
        add({
          kind: 'cookie',
          name: c.name,
          providerDomain: sameSite(providerDomain, opts.allowedHosts) ? '' : providerDomain,
          firstSeenUrl: url,
          attributes: { domain: c.domain, path: c.path, expires: c.expires, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite },
        });
      }
      pages.push(result);
      await opts.onPage?.(result, pages.length);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return { pages, findings: [...findings.values()] };
}
