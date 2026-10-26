import type { Category, ConsentAction, ConsentChoices, PublicConfig, StoredConsent, BannerTexts } from '@consentflow/shared';
import { OPTIONAL_CATEGORIES, resolveTexts, toGoogleConsent } from '@consentflow/shared';
import { Blocker } from './blocker';
import { allChoices, deleteCookiesMatching, isValid, newConsentId, readConsent, writeConsent } from './storage';
import { ConsentUI, h } from './ui';
import { PLACEHOLDER_CSS } from './styles';
import { renderDeclaration } from './declaration';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    ConsentFlow?: ConsentFlowApi;
    __CF_CONFIG__?: PublicConfig;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

export interface ConsentFlowApi {
  readonly consentId: string | null;
  readonly regulation: string;
  getConsent(): ConsentChoices & { necessary: true };
  hasConsent(category: Category): boolean;
  show(): void;
  showPreferences(): void;
  acceptAll(): void;
  rejectAll(): void;
  setConsent(choices: Partial<ConsentChoices>): void;
  withdraw(): void;
  on(event: 'change', fn: (c: ConsentChoices) => void): () => void;
}

export interface InitOptions {
  lang?: string | null;
  fetchImpl?: typeof fetch;
}

function pickLanguage(cfg: PublicConfig, explicit?: string | null): string {
  const langs = cfg.banner.languages.length ? cfg.banner.languages : ['en'];
  const candidates = [explicit, document.documentElement.lang, ...(navigator.languages ?? []), navigator.language];
  for (const c of candidates) {
    if (!c) continue;
    const code = c.toLowerCase().split('-')[0];
    if (langs.includes(code)) return code;
  }
  return langs.includes(cfg.banner.defaultLanguage) ? cfg.banner.defaultLanguage : langs[0];
}

function ensureGtag(): (...args: unknown[]) => void {
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
  }
  return window.gtag;
}

export function init(cfg: PublicConfig, opts: InitOptions = {}): ConsentFlowApi {
  const doFetch = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(window) : null);
  const preview = !!cfg.preview;
  const gpc = navigator.globalPrivacyControl === true && cfg.honorGpc;
  const lang = pickLanguage(cfg, opts.lang);
  const texts: BannerTexts = resolveTexts(lang, cfg.banner.texts[lang]);
  const listeners = new Set<(c: ConsentChoices) => void>();

  const stored = preview ? null : readConsent();
  const valid = isValid(stored, cfg.bannerVersion, cfg.consentExpiryDays);
  let consentId: string | null = stored?.id ?? null;
  let decided: boolean = valid;
  let choices: ConsentChoices;
  let showBanner = false;
  let autoAction: ConsentAction | null = null;

  if (preview) {
    choices = allChoices(false);
    showBanner = true;
  } else if (valid) {
    choices = { ...stored!.c };
    // GPC overrides an earlier "sale/share" opt-in in opt-out regions.
    if (gpc && cfg.model === 'opt_out' && choices.marketing) {
      choices.marketing = false;
      autoAction = 'gpc_opt_out';
    }
  } else if (cfg.model === 'opt_in') {
    choices = allChoices(false);
    showBanner = true;
  } else if (cfg.model === 'opt_out') {
    choices = allChoices(true);
    if (gpc) {
      choices.marketing = false;
      autoAction = 'gpc_opt_out';
    } else showBanner = true;
  } else {
    choices = allChoices(true);
    if (gpc) choices.marketing = false;
    showBanner = true;
  }

  const allowed = (c: Category) => c === 'necessary' || choices[c as keyof ConsentChoices] === true;

  // 1. Google Consent Mode defaults must be pushed before any Google tag runs.
  const gtag = cfg.googleConsentMode ? ensureGtag() : null;
  if (gtag) {
    gtag('consent', 'default', { ...toGoogleConsent(choices), wait_for_update: 500 });
    gtag('set', 'ads_data_redaction', !choices.marketing);
  }

  // 2. Blocking, installed synchronously so it sees tags parsed after this script.
  const blocker = new Blocker(cfg.blocking, allowed, (iframe, category) => {
    const name = texts.categories[category].name;
    const w = iframe.getAttribute('width') || iframe.style.width;
    const hgt = iframe.getAttribute('height') || iframe.style.height;
    const size = `${w ? `width:${/^\d+$/.test(w) ? w + 'px' : w};` : 'width:100%;'}${hgt ? `height:${/^\d+$/.test(hgt) ? hgt + 'px' : hgt};` : 'min-height:200px;'}`;
    return h(
      'div',
      { style: PLACEHOLDER_CSS + size, 'data-cf-placeholder': category },
      h('p', { style: 'margin:0' }, texts.blockedContent.replace('{category}', name.toLowerCase())),
      h(
        'button',
        {
          type: 'button',
          style: `font:inherit;font-weight:600;padding:8px 14px;border-radius:6px;border:0;cursor:pointer;background:${cfg.banner.theme.primary};color:${cfg.banner.theme.primaryText}`,
          onclick: () => update({ ...choices, [category]: true }, 'custom'),
        },
        texts.allowContent.replace('{category}', name.toLowerCase()),
      ),
    );
  });
  if (cfg.autoBlock && !preview) blocker.installAuto();

  function record(action: ConsentAction) {
    if (preview || !doFetch) return;
    const body = JSON.stringify({
      domainKey: cfg.domainKey,
      consentId,
      action,
      choices,
      bannerVersion: cfg.bannerVersion,
      regulation: cfg.regulation,
      url: location.href.split('#')[0].slice(0, 500),
      gpc: navigator.globalPrivacyControl === true,
    });
    doFetch(`${cfg.apiBase}/v1/consent`, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
  }

  function persist(action: ConsentAction) {
    if (preview) return;
    consentId = consentId || newConsentId();
    const value: StoredConsent = { id: consentId, v: cfg.bannerVersion, c: choices, ts: Date.now(), r: cfg.regulation, a: action };
    writeConsent(value, cfg.consentExpiryDays);
    decided = true;
  }

  function emit() {
    const detail = { ...choices, necessary: true };
    if (gtag) {
      gtag('consent', 'update', toGoogleConsent(choices));
      gtag('set', 'ads_data_redaction', !choices.marketing);
    }
    (window.dataLayer = window.dataLayer || []).push({ event: 'consentflow_update', consentflow: detail });
    window.dispatchEvent(new CustomEvent('consentflow:change', { detail }));
    listeners.forEach((fn) => fn({ ...choices }));
  }

  function revokedCategories(prev: ConsentChoices, next: ConsentChoices): Category[] {
    return OPTIONAL_CATEGORIES.filter((c) => prev[c] && !next[c]);
  }

  function update(next: ConsentChoices, action: ConsentAction) {
    const prev = choices;
    choices = { ...next };
    persist(action);
    record(action);
    ui?.closeAll();
    emit();
    blocker.release();
    const revoked = revokedCategories(prev, choices);
    if (revoked.length && !preview) {
      for (const cat of revoked) for (const c of cfg.cookies[cat] ?? []) if (!c.provider) deleteCookiesMatching(c.name);
      // Scripts that already ran cannot be unloaded; a reload starts the page clean.
      setTimeout(() => location.reload(), 50);
    }
  }

  let ui: ConsentUI | null = null;
  const handlers = {
    acceptAll: () => update(allChoices(true), 'accept_all'),
    rejectAll: () => update(allChoices(false), 'reject_all'),
    save: (c: ConsentChoices) => update(c, 'custom'),
    acknowledge: () => update(choices, cfg.model === 'notice' ? 'implied' : 'custom'),
  };

  function mountUi() {
    ui = new ConsentUI(cfg, texts, cfg.model, handlers, () => choices);
    if (showBanner) {
      ui.showBanner();
      if (!preview && doFetch) {
        doFetch(`${cfg.apiBase}/v1/cmp/${cfg.domainKey}/impression`, { method: 'POST', keepalive: true }).catch(() => {});
      }
    } else ui.showFab();
    blocker.collectManual();
    blocker.release();
    const decl = document.getElementById('consentflow-declaration');
    if (decl) renderDeclaration(decl, cfg, texts, () => api);
  }

  const api: ConsentFlowApi = {
    get consentId() {
      return consentId;
    },
    regulation: cfg.regulation,
    getConsent: () => ({ ...choices, necessary: true }),
    hasConsent: (c) => allowed(c),
    show: () => ui?.showBanner(),
    showPreferences: () => ui?.showPreferences(),
    acceptAll: handlers.acceptAll,
    rejectAll: handlers.rejectAll,
    setConsent: (c) => update({ ...choices, ...c }, 'custom'),
    withdraw: () => update(allChoices(false), 'withdraw'),
    on: (_e, fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  if (autoAction) {
    persist(autoAction);
    record(autoAction);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountUi, { once: true });
  else mountUi();

  if (!preview) window.ConsentFlow = api;
  return api;
}
