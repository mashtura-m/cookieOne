import type { ConsentChoices, StoredConsent } from '@consentflow/shared';

export const CONSENT_COOKIE = 'cf_consent';

function b64encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(s: string): string {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)));
}

export function readCookie(name: string): string | null {
  const parts = document.cookie ? document.cookie.split('; ') : [];
  for (const p of parts) {
    const i = p.indexOf('=');
    if (p.slice(0, i) === name) return p.slice(i + 1);
  }
  return null;
}

export function readConsent(): StoredConsent | null {
  const raw = readCookie(CONSENT_COOKIE);
  if (!raw) return null;
  try {
    const v = JSON.parse(b64decode(raw)) as StoredConsent;
    if (!v || typeof v.id !== 'string' || typeof v.v !== 'number' || !v.c) return null;
    return v;
  } catch {
    return null;
  }
}

export function writeConsent(value: StoredConsent, expiryDays: number): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${b64encode(JSON.stringify(value))}; Max-Age=${Math.round(expiryDays * 86400)}; Path=/; SameSite=Lax${secure}`;
}

export function isValid(stored: StoredConsent | null, bannerVersion: number, expiryDays: number, now = Date.now()): stored is StoredConsent {
  if (!stored) return false;
  if (stored.v !== bannerVersion) return false; // a newly published banner re-prompts everyone
  return now - stored.ts < expiryDays * 86400 * 1000;
}

export function newConsentId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Best-effort removal of a cookie on every host/path combination it may have been set with. */
export function deleteCookie(name: string): void {
  const host = location.hostname;
  const parts = host.split('.');
  const domains = [''];
  for (let i = 0; i < parts.length - 1; i++) domains.push('; Domain=.' + parts.slice(i).join('.'));
  const paths = ['/', location.pathname];
  for (const d of domains) for (const p of paths) document.cookie = `${name}=; Max-Age=0; Path=${p}${d}`;
}

export function deleteCookiesMatching(pattern: string): void {
  if (!document.cookie) return;
  let re: RegExp | null = null;
  const isRegex = /[\^$*+?()[\]{}|\\]/.test(pattern);
  if (isRegex) {
    try {
      re = new RegExp(pattern);
    } catch {
      return;
    }
  }
  for (const p of document.cookie.split('; ')) {
    const name = p.slice(0, p.indexOf('='));
    if (name === CONSENT_COOKIE) continue;
    if (re ? re.test(name) : name === pattern) deleteCookie(name);
  }
}

export const allChoices = (v: boolean): ConsentChoices => ({ preferences: v, statistics: v, marketing: v });
