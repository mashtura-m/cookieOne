import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tx } from './db';
import { config } from './config';

type CookieRow = [name: string, isRegex: boolean, vendor: string, provider: string | null, category: string, purpose: string, retention: string | null];
type ScriptRow = [vendor: string, urlPattern: string, category: string];

/** Loads the global cookie and tracker knowledge base. Safe to run repeatedly (upserts). */
export async function seedLibrary(log: (m: string) => void = console.log): Promise<{ cookies: number; scripts: number }> {
  const cookies = JSON.parse(await readFile(join(config.seedDir, 'cookie-library.json'), 'utf8')) as CookieRow[];
  const scripts = JSON.parse(await readFile(join(config.seedDir, 'vendor-scripts.json'), 'utf8')) as ScriptRow[];
  await tx(async (c) => {
    for (const [name, isRegex, vendor, provider, category, purpose, retention] of cookies) {
      await c.query(
        `INSERT INTO cookie_library (name_pattern, is_regex, vendor, provider_domain, category, purpose, retention)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (name_pattern, vendor) DO UPDATE SET is_regex=EXCLUDED.is_regex, provider_domain=EXCLUDED.provider_domain,
           category=EXCLUDED.category, purpose=EXCLUDED.purpose, retention=EXCLUDED.retention`,
        [name, isRegex, vendor, provider, category, purpose, retention],
      );
    }
    for (const [vendor, pattern, category] of scripts) {
      await c.query(
        `INSERT INTO vendor_scripts (vendor, url_pattern, category) VALUES ($1,$2,$3)
         ON CONFLICT (url_pattern) DO UPDATE SET vendor=EXCLUDED.vendor, category=EXCLUDED.category`,
        [vendor, pattern, category],
      );
    }
  });
  log(`seeded ${cookies.length} library cookies and ${scripts.length} tracker scripts`);
  return { cookies: cookies.length, scripts: scripts.length };
}
