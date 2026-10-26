export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:4000';

const TOKEN_KEY = 'consentflow.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T = unknown>(path: string, opts: { method?: Method; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_URL}. Check that it is running.`);
  }
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event('consentflow:signed-out'));
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Downloads a file from an authenticated endpoint. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) throw new ApiError(res.status, 'Export failed');
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Shared response types -------------------------------------------------

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type Cat = 'necessary' | 'preferences' | 'statistics' | 'marketing' | 'unclassified';

export interface Org { id: string; name: string; plan: string; role: Role }
export interface Me { user: { id: string; email: string; name: string }; orgs: Org[] }

export interface Install { scriptUrl: string; html: string; declarationHtml: string }
export interface Domain {
  id: string; org_id: string; hostname: string; public_key: string; extra_hostnames: string[];
  scan_page_limit: number; scan_frequency: 'off' | 'weekly' | 'monthly'; consent_expiry_days: number;
  privacy_policy_url: string | null; google_consent_mode: boolean; auto_block: boolean; role: Role; install: Install;
}
export interface DomainListItem {
  id: string; hostname: string; public_key: string; created_at: string; consents_30d: number; cookie_count: number; unclassified_count: number;
  last_scan: { id: string; status: ScanStatus; finished_at: string | null; cookies_found: number } | null;
}
export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';
export interface Scan {
  id: string; status: ScanStatus; trigger: string; page_limit: number; pages_scanned: number; cookies_found: number; new_items: number;
  error: string | null; queued_at: string; started_at: string | null; finished_at: string | null; requested_by_name?: string | null;
}
export interface Finding { id: number; kind: string; name: string; provider_domain: string | null; first_seen_url: string | null; category: Cat; vendor: string | null; attributes: Record<string, unknown>; set_before_consent: boolean }
export interface ScanDetail extends Scan { pages: { url: string; status_code: number | null; error: string | null }[]; findings: Finding[] }
export interface DomainCookie { id: string; kind: string; name: string; provider_domain: string; category: Cat; vendor: string | null; purpose: string | null; retention: string | null; source: string; is_overridden: boolean; first_seen_at: string; last_seen_at: string }
export interface DomainScript { id: string; url_pattern: string; category: Cat; vendor: string | null; source: string; last_seen_at: string }
export interface ComplianceCheck { id: string; label: string; passed: boolean; detail: string }
export interface Overview {
  domain: Domain;
  compliance: { score: number; checks: ComplianceCheck[] };
  lastScan: Scan | null;
  byCategory: { category: Cat; count: number }[];
  banner: { version: number; published_at: string } | null;
}
export interface Stats {
  days: number;
  daily: { day: string; impressions: number; accept_all: number; reject_all: number; custom: number; other: number }[];
  totals: { impressions: number; accept_all: number; reject_all: number; custom: number; other: number };
  rates: { acceptAll: number | null; rejectAll: number | null; custom: number | null; interaction: number | null };
  categories: { preferences: number; statistics: number; marketing: number; total: number };
  countries: { country: string; total: number; accept_all: number; reject_all: number }[];
}
export interface ConsentRow {
  id: number; consent_id: string; action: string; preferences: boolean; statistics: boolean; marketing: boolean; banner_version: number;
  regulation: string; country: string | null; region: string | null; ip_truncated: string | null; user_agent: string | null; page_url: string | null; gpc: boolean; created_at: string;
}
export interface BannerTheme { background: string; text: string; primary: string; primaryText: string; secondary: string; secondaryText: string; radius: number; fontFamily: string }
export interface BannerConfig {
  id: string; version: number; status: string; layout: 'bar' | 'box' | 'popup'; position: 'bottom' | 'top' | 'bottom-left' | 'bottom-right' | 'center';
  theme: Partial<BannerTheme>; texts: Record<string, Record<string, unknown>>; languages: string[]; defaultLanguage: string;
  showRejectAll: boolean; showFloatingButton: boolean; customCss: string; createdAt: string; publishedAt: string | null; createdByName?: string | null;
}
export interface GeoRuleRow { id?: string; name: string; regulation: 'gdpr' | 'ccpa' | 'lgpd' | 'none'; model: 'opt_in' | 'opt_out' | 'notice'; regions: string[]; honorGpc: boolean; priority: number; enabled: boolean }
export interface Member { id: string; name: string; email: string; role: Role; created_at: string; last_login_at: string | null }
export interface Invitation { id: string; email: string; role: Role; expires_at: string }
export interface AuditEntry { id: number; action: string; details: Record<string, unknown>; created_at: string; user_name: string | null; hostname: string | null }
