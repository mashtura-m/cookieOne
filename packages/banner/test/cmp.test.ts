import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@consentflow/shared';
import { DEFAULT_THEME } from '@consentflow/shared';
import { init } from '../src/cmp';
import { Blocker, BLOCKED_TYPE } from '../src/blocker';
import { readConsent, writeConsent, isValid, CONSENT_COOKIE } from '../src/storage';

function config(over: Partial<PublicConfig> = {}): PublicConfig {
  return {
    domainKey: 'test-key',
    apiBase: 'https://api.example',
    bannerVersion: 3,
    regulation: 'gdpr',
    model: 'opt_in',
    honorGpc: true,
    country: 'DE',
    region: null,
    consentExpiryDays: 365,
    googleConsentMode: true,
    autoBlock: false,
    privacyPolicyUrl: 'https://example.com/privacy',
    banner: {
      layout: 'box',
      position: 'bottom-left',
      theme: DEFAULT_THEME,
      texts: {},
      languages: ['en', 'de'],
      defaultLanguage: 'en',
      showRejectAll: true,
      showFloatingButton: true,
      customCss: '',
    },
    cookies: {
      necessary: [{ name: 'cf_consent', provider: '', purpose: 'Stores consent', retention: '1 year', kind: 'cookie' }],
      preferences: [],
      statistics: [{ name: '_ga', provider: '', purpose: 'Analytics', retention: '2 years', kind: 'cookie' }],
      marketing: [],
    },
    blocking: [{ pattern: 'tracker.example', category: 'marketing' }],
    ...over,
  };
}

const shadow = () => document.getElementById('consentflow-root')!.shadowRoot!;
const btn = (name: string) => shadow().querySelector<HTMLButtonElement>(`[data-cf="${name}"]`);

function clearCookies() {
  for (const c of document.cookie.split('; ')) {
    const n = c.split('=')[0];
    if (n) document.cookie = `${n}=; Max-Age=0; Path=/`;
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  clearCookies();
  window.dataLayer = [];
  delete window.gtag;
  delete window.ConsentFlow;
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: undefined, configurable: true });
  fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
});
afterEach(() => {
  document.getElementById('consentflow-root')?.remove();
});

const bodies = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/v1/consent')).map((c) => JSON.parse((c[1] as RequestInit).body as string));

describe('opt-in (GDPR)', () => {
  it('shows the banner with equal accept and reject buttons and denies everything by default', () => {
    const api = init(config(), { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(btn('accept')).toBeTruthy();
    expect(btn('reject')).toBeTruthy();
    expect(btn('reject')!.className).toBe(btn('accept')!.className);
    expect(api.getConsent()).toEqual({ necessary: true, preferences: false, statistics: false, marketing: false });
    const defaults = (window.dataLayer as IArguments[]).find((a) => a[0] === 'consent' && a[1] === 'default')!;
    expect(defaults[2]).toMatchObject({ ad_storage: 'denied', analytics_storage: 'denied', wait_for_update: 500 });
    expect(fetchMock).toHaveBeenCalledWith('https://api.example/v1/cmp/test-key/impression', expect.anything());
  });

  it('accept all stores consent, updates consent mode, records it and releases blocked scripts', () => {
    document.body.innerHTML = '<script type="text/plain" data-category="statistics">window.__statsRan = true;</script>';
    const api = init(config(), { fetchImpl: fetchMock as unknown as typeof fetch });
    btn('accept')!.click();
    expect(api.getConsent().statistics).toBe(true);
    const stored = readConsent()!;
    expect(stored).toMatchObject({ v: 3, c: { preferences: true, statistics: true, marketing: true }, a: 'accept_all' });
    expect(bodies()[0]).toMatchObject({ action: 'accept_all', domainKey: 'test-key', consentId: stored.id, bannerVersion: 3 });
    const update = (window.dataLayer as IArguments[]).find((a) => a[0] === 'consent' && a[1] === 'update')!;
    expect(update[2]).toMatchObject({ ad_storage: 'granted', analytics_storage: 'granted' });
    expect(document.querySelector('script[data-cf-released]')).toBeTruthy();
    expect(shadow().querySelector('.banner')).toBeNull();
    expect(shadow().querySelector('.fab')).toBeTruthy();
  });

  it('saves a custom choice from the preference center', () => {
    const api = init(config(), { fetchImpl: fetchMock as unknown as typeof fetch });
    btn('customize')!.click();
    const stats = shadow().querySelector<HTMLInputElement>('input[data-cat="statistics"]')!;
    stats.checked = true;
    btn('pref-save')!.click();
    expect(api.getConsent()).toMatchObject({ statistics: true, marketing: false, preferences: false });
    expect(bodies()[0].action).toBe('custom');
  });

  it('does not show the banner again while stored consent is valid, but re-prompts on a new banner version', () => {
    writeConsent({ id: 'abc', v: 3, c: { preferences: true, statistics: false, marketing: false }, ts: Date.now(), r: 'gdpr', a: 'custom' }, 365);
    const api = init(config(), { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(btn('accept')).toBeNull();
    expect(api.getConsent().preferences).toBe(true);
    document.getElementById('consentflow-root')!.remove();
    init(config({ bannerVersion: 4 }), { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(btn('accept')).toBeTruthy();
  });

  it('picks the visitor language', () => {
    init(config(), { fetchImpl: fetchMock as unknown as typeof fetch, lang: 'de-AT' });
    expect(btn('accept')!.textContent).toBe('Alle akzeptieren');
  });

  it('hides reject all when the admin turned it off', () => {
    const c = config();
    c.banner.showRejectAll = false;
    init(c, { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(btn('reject')).toBeNull();
  });
});

describe('opt-out (CCPA)', () => {
  it('allows everything by default and shows a Do Not Sell link', () => {
    const api = init(config({ regulation: 'ccpa', model: 'opt_out' }), { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(api.getConsent().marketing).toBe(true);
    expect(btn('donotsell')).toBeTruthy();
  });

  it('honors Global Privacy Control automatically', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    const api = init(config({ regulation: 'ccpa', model: 'opt_out' }), { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(api.getConsent()).toMatchObject({ marketing: false, statistics: true });
    expect(btn('donotsell')).toBeNull();
    expect(bodies()[0]).toMatchObject({ action: 'gpc_opt_out', gpc: true });
  });
});

describe('preview mode', () => {
  it('always shows the banner and never stores or records', () => {
    writeConsent({ id: 'abc', v: 3, c: { preferences: true, statistics: true, marketing: true }, ts: Date.now(), r: 'gdpr', a: 'accept_all' }, 365);
    init(config({ preview: true }), { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(btn('accept')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.ConsentFlow).toBeUndefined();
  });
});

describe('Blocker', () => {
  it('neutralises matching scripts inserted into the page and runs them after consent', async () => {
    let marketing = false;
    const b = new Blocker([{ pattern: 'tracker.example', category: 'marketing' }], (c) => c === 'necessary' || (c === 'marketing' && marketing));
    b.installAuto();
    const s = document.createElement('script');
    s.src = 'https://tracker.example/pixel.js';
    document.head.appendChild(s);
    expect(s.type).toBe(BLOCKED_TYPE);
    s.type = 'text/javascript'; // the page cannot undo the block
    expect(s.getAttribute('type')).toBe(BLOCKED_TYPE);
    const other = document.createElement('script');
    other.src = 'https://cdn.example/app.js';
    document.head.appendChild(other);
    expect(other.type).toBe('');
    expect(b.pending()).toHaveLength(1);
    marketing = true;
    expect(b.release()).toBe(1);
    const released = document.head.querySelector('script[data-cf-released]') as HTMLScriptElement;
    expect(released.src).toBe('https://tracker.example/pixel.js');
    expect(released.type).toBe('text/javascript');
    b.stop();
  });

  it('replaces blocked iframes with a placeholder', () => {
    document.body.innerHTML = '<iframe data-cf-src="https://www.youtube.com/embed/x" data-category="marketing" width="560" height="315"></iframe>';
    let ok = false;
    const b = new Blocker([], (c) => c === 'necessary' || ok, () => {
      const d = document.createElement('div');
      d.className = 'ph';
      return d;
    });
    b.collectManual();
    expect(document.querySelector('.ph')).toBeTruthy();
    expect(document.querySelector('iframe')!.getAttribute('src')).toBeNull();
    ok = true;
    b.release();
    expect(document.querySelector('.ph')).toBeNull();
    expect(document.querySelector('iframe')!.getAttribute('src')).toBe('https://www.youtube.com/embed/x');
  });
});

describe('storage', () => {
  it('round-trips the consent cookie and checks expiry', () => {
    writeConsent({ id: 'id1', v: 1, c: { preferences: false, statistics: true, marketing: false }, ts: 1000, r: 'gdpr', a: 'custom' }, 30);
    expect(document.cookie).toContain(CONSENT_COOKIE + '=');
    const v = readConsent();
    expect(v?.c.statistics).toBe(true);
    expect(isValid(v, 1, 30, 1000 + 29 * 86400e3)).toBe(true);
    expect(isValid(v, 1, 30, 1000 + 31 * 86400e3)).toBe(false);
    expect(isValid(v, 2, 30, 1000)).toBe(false);
  });
});

describe('cookie declaration', () => {
  it('renders the declaration table on the privacy page', () => {
    document.body.innerHTML = '<div id="consentflow-declaration"></div>';
    init(config(), { fetchImpl: fetchMock as unknown as typeof fetch });
    const el = document.getElementById('consentflow-declaration')!;
    expect(el.querySelectorAll('table').length).toBe(2);
    expect(el.textContent).toContain('_ga');
  });
});
