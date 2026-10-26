export const CATEGORIES = ['necessary', 'preferences', 'statistics', 'marketing'] as const;
export type Category = (typeof CATEGORIES)[number];
export type CategoryOrUnclassified = Category | 'unclassified';
export type OptionalCategory = Exclude<Category, 'necessary'>;
export const OPTIONAL_CATEGORIES: OptionalCategory[] = ['preferences', 'statistics', 'marketing'];

export type Regulation = 'gdpr' | 'ccpa' | 'lgpd' | 'none';
export type ConsentModel = 'opt_in' | 'opt_out' | 'notice';
export type ConsentAction = 'accept_all' | 'reject_all' | 'custom' | 'withdraw' | 'gpc_opt_out' | 'implied';
export type MemberRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type Layout = 'bar' | 'box' | 'popup';
export type Position = 'bottom' | 'top' | 'bottom-left' | 'bottom-right' | 'center';

/** Choices for the optional categories. Necessary is always true. */
export type ConsentChoices = Record<OptionalCategory, boolean>;

export interface BannerTheme {
  background: string;
  text: string;
  primary: string;
  primaryText: string;
  secondary: string;
  secondaryText: string;
  radius: number;
  fontFamily: string;
}

export interface BannerTexts {
  title: string;
  description: string;
  acceptAll: string;
  rejectAll: string;
  customize: string;
  save: string;
  preferencesTitle: string;
  preferencesDescription: string;
  privacyPolicy: string;
  doNotSell: string;
  ccpaDescription: string;
  noticeDescription: string;
  ok: string;
  alwaysActive: string;
  cookiesUsed: string;
  floatingButton: string;
  blockedContent: string;
  allowContent: string;
  categories: Record<Category, { name: string; description: string }>;
  table: { name: string; provider: string; purpose: string; expiry: string; firstParty: string };
}

export interface GeoRule {
  id?: string;
  name: string;
  regulation: Regulation;
  model: ConsentModel;
  regions: string[];
  honorGpc: boolean;
  priority: number;
  enabled: boolean;
}

export interface PublicCookie {
  name: string;
  provider: string;
  purpose: string;
  retention: string;
  kind: string;
}

/** Everything the embed script needs, inlined into cmp.js per request. */
export interface PublicConfig {
  domainKey: string;
  apiBase: string;
  bannerVersion: number;
  regulation: Regulation;
  model: ConsentModel;
  honorGpc: boolean;
  country: string | null;
  region: string | null;
  consentExpiryDays: number;
  googleConsentMode: boolean;
  autoBlock: boolean;
  privacyPolicyUrl: string | null;
  banner: {
    layout: Layout;
    position: Position;
    theme: BannerTheme;
    texts: Record<string, Partial<BannerTexts>>;
    languages: string[];
    defaultLanguage: string;
    showRejectAll: boolean;
    showFloatingButton: boolean;
    customCss: string;
  };
  cookies: Record<Category, PublicCookie[]>;
  blocking: { pattern: string; category: Category }[];
  preview?: boolean;
}

export interface StoredConsent {
  id: string;
  v: number;
  c: ConsentChoices;
  ts: number;
  r: Regulation;
  a: ConsentAction;
}
