import type { CategoryOrUnclassified } from './types';

export interface LibraryCookie {
  id: number;
  namePattern: string;
  isRegex: boolean;
  vendor: string;
  providerDomain: string | null;
  category: CategoryOrUnclassified;
  purpose: string;
  retention: string | null;
}

export interface LibraryScript {
  vendor: string;
  urlPattern: string;
  category: CategoryOrUnclassified;
}

export interface CookieMatch {
  libraryId: number;
  vendor: string;
  category: CategoryOrUnclassified;
  purpose: string;
  retention: string | null;
}

const regexCache = new Map<string, RegExp | null>();
function toRegex(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    try {
      // Library patterns always match the whole cookie name.
      regexCache.set(pattern, new RegExp(`^(?:${pattern.replace(/^\^/, '').replace(/\$$/, '')})$`));
    } catch {
      regexCache.set(pattern, null);
    }
  }
  return regexCache.get(pattern)!;
}

/** Registrable-ish domain: strips a leading dot and "www." so ".google.com" matches "google.com". */
export function normalizeDomain(d: string | null | undefined): string {
  return (d ?? '').replace(/^\./, '').replace(/^www\./, '').toLowerCase();
}

function domainMatches(cookieDomain: string, libraryDomain: string | null): boolean {
  if (!libraryDomain) return true;
  const a = normalizeDomain(cookieDomain);
  const b = normalizeDomain(libraryDomain);
  return a === b || a.endsWith('.' + b);
}

/**
 * Find the library entry for a cookie. Exact name matches beat regex matches, and entries whose
 * provider domain matches beat entries without one.
 */
export function categorizeCookie(name: string, providerDomain: string, library: LibraryCookie[]): CookieMatch | null {
  let best: { entry: LibraryCookie; score: number } | null = null;
  for (const entry of library) {
    const nameOk = entry.isRegex ? toRegex(entry.namePattern)?.test(name) ?? false : entry.namePattern === name;
    if (!nameOk) continue;
    // A library entry bound to a third-party domain only matches cookies from that domain,
    // unless the cookie is first party and the library entry describes a first-party tag (e.g. _ga).
    if (entry.providerDomain && providerDomain && !domainMatches(providerDomain, entry.providerDomain)) continue;
    const score = (entry.isRegex ? 0 : 2) + (entry.providerDomain && providerDomain ? 1 : 0);
    if (!best || score > best.score) best = { entry, score };
  }
  if (!best) return null;
  const e = best.entry;
  return { libraryId: e.id, vendor: e.vendor, category: e.category, purpose: e.purpose, retention: e.retention };
}

export function categorizeScript(url: string, library: LibraryScript[]): LibraryScript | null {
  let best: LibraryScript | null = null;
  for (const entry of library) {
    if (url.includes(entry.urlPattern) && (!best || entry.urlPattern.length > best.urlPattern.length)) best = entry;
  }
  return best;
}

/** Human readable retention from a cookie expiry (seconds since epoch, -1 for session). */
export function describeRetention(expires: number | undefined, now = Date.now() / 1000): string {
  if (expires === undefined || expires < 0) return 'Session';
  const secs = Math.max(0, expires - now);
  const days = Math.round(secs / 86400);
  if (days < 1) return `${Math.max(1, Math.round(secs / 3600))} hours`;
  if (days < 60) return `${days} days`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months`;
  return `${Math.round(days / 365)} years`;
}
