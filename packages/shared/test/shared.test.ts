import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEO_RULES, resolveRule, categorizeCookie, categorizeScript, truncateIp, toGoogleConsent,
  describeRetention, resolveTexts, type LibraryCookie,
} from '../src';

describe('resolveRule', () => {
  it('applies GDPR in Germany', () => {
    expect(resolveRule(DEFAULT_GEO_RULES, 'DE', null).regulation).toBe('gdpr');
  });
  it('applies CCPA in California but not in a US state without a law', () => {
    expect(resolveRule(DEFAULT_GEO_RULES, 'US', 'CA')).toMatchObject({ regulation: 'ccpa', model: 'opt_out' });
    expect(resolveRule(DEFAULT_GEO_RULES, 'US', 'WY').regulation).toBe('none');
  });
  it('falls back to the * rule for unknown countries', () => {
    expect(resolveRule(DEFAULT_GEO_RULES, null, null).model).toBe('notice');
  });
  it('falls back to strict opt-in when nothing matches', () => {
    expect(resolveRule([], 'JP', null)).toMatchObject({ regulation: 'gdpr', model: 'opt_in' });
  });
  it('ignores disabled rules', () => {
    const rules = DEFAULT_GEO_RULES.map((r) => (r.regulation === 'gdpr' ? { ...r, enabled: false } : r));
    expect(resolveRule(rules, 'FR', null).regulation).toBe('none');
  });
});

const lib: LibraryCookie[] = [
  { id: 1, namePattern: '_ga', isRegex: false, vendor: 'Google Analytics', providerDomain: null, category: 'statistics', purpose: 'p', retention: '2 years' },
  { id: 2, namePattern: '^_ga_[A-Z0-9]+$', isRegex: true, vendor: 'Google Analytics', providerDomain: null, category: 'statistics', purpose: 'p', retention: '2 years' },
  { id: 3, namePattern: 'IDE', isRegex: false, vendor: 'Google Ads', providerDomain: 'doubleclick.net', category: 'marketing', purpose: 'p', retention: '13 months' },
];

describe('categorizeCookie', () => {
  it('matches exact names', () => expect(categorizeCookie('_ga', 'example.com', lib)?.libraryId).toBe(1));
  it('matches regex names', () => expect(categorizeCookie('_ga_ABC123', 'example.com', lib)?.libraryId).toBe(2));
  it('respects the provider domain', () => {
    expect(categorizeCookie('IDE', '.doubleclick.net', lib)?.category).toBe('marketing');
    expect(categorizeCookie('IDE', 'example.com', lib)).toBeNull();
  });
  it('returns null for unknown cookies', () => expect(categorizeCookie('foo', 'example.com', lib)).toBeNull());
});

describe('helpers', () => {
  it('categorizes scripts by the longest pattern', () => {
    const s = [
      { vendor: 'Google', urlPattern: 'google.com', category: 'marketing' as const },
      { vendor: 'reCAPTCHA', urlPattern: 'google.com/recaptcha', category: 'necessary' as const },
    ];
    expect(categorizeScript('https://www.google.com/recaptcha/api.js', s)?.vendor).toBe('reCAPTCHA');
  });
  it('truncates IPs', () => {
    expect(truncateIp('203.0.113.42')).toBe('203.0.113.0');
    expect(truncateIp('::ffff:10.1.2.3')).toBe('10.1.2.0');
    expect(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
  });
  it('maps consent mode signals', () => {
    expect(toGoogleConsent({ preferences: true, statistics: false, marketing: false })).toMatchObject({
      analytics_storage: 'denied', ad_storage: 'denied', functionality_storage: 'granted',
    });
  });
  it('describes retention', () => {
    expect(describeRetention(-1)).toBe('Session');
    expect(describeRetention(1000 + 86400 * 400, 1000)).toBe('13 months');
  });
  it('merges text overrides', () => {
    const t = resolveTexts('de', { title: 'Hallo' });
    expect(t.title).toBe('Hallo');
    expect(t.acceptAll).toBe('Alle akzeptieren');
  });
});
