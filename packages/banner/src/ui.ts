import type { BannerTexts, Category, ConsentChoices, ConsentModel, PublicConfig, OptionalCategory } from '@consentflow/shared';
import { CATEGORIES, OPTIONAL_CATEGORIES } from '@consentflow/shared';
import { buildCss } from './styles';

type Attrs = Record<string, string | boolean | ((e: Event) => void)>;

export function h(tag: string, attrs: Attrs = {}, ...children: (Node | string | null | false)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const COOKIE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.3A9 9 0 1 1 11.7 3a3 3 0 0 0 3.6 3.6 3 3 0 0 0 3.6 3.6 3 3 0 0 0 2.1 2.1z"/><circle cx="8.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="12" cy="15.5" r=".9" fill="currentColor"/><circle cx="16" cy="13" r=".9" fill="currentColor"/></svg>';

export interface UiHandlers {
  acceptAll(): void;
  rejectAll(): void;
  save(choices: ConsentChoices): void;
  acknowledge(): void;
}

export class ConsentUI {
  private host: HTMLElement;
  private root: ShadowRoot;
  private wrap: HTMLElement;
  private bannerEl: HTMLElement | null = null;
  private backdropEl: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;
  private fabEl: HTMLElement | null = null;
  private lastFocus: Element | null = null;

  constructor(
    private cfg: PublicConfig,
    private t: BannerTexts,
    private model: ConsentModel,
    private handlers: UiHandlers,
    private getChoices: () => ConsentChoices,
  ) {
    this.host = document.createElement('div');
    this.host.id = 'consentflow-root';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = buildCss(cfg.banner.theme, cfg.banner.customCss);
    this.wrap = h('div', { class: 'cf' });
    this.root.append(style, this.wrap);
    (document.body || document.documentElement).appendChild(this.host);
    this.root.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape' && this.modalEl) this.hidePreferences();
    });
  }

  get shadow(): ShadowRoot {
    return this.root;
  }

  private policyLink(): HTMLElement | null {
    const url = this.cfg.privacyPolicyUrl;
    return url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, this.t.privacyPolicy) : null;
  }

  showBanner(): void {
    this.hideBanner();
    this.hideFab();
    const { layout, position, showRejectAll } = this.cfg.banner;
    const t = this.t;
    const titleId = 'cf-title';
    let body: string;
    let actions: HTMLElement[];
    if (this.model === 'opt_in') {
      body = t.description;
      actions = [
        h('button', { class: 'btn btn-sec', type: 'button', 'data-cf': 'customize', onclick: () => this.showPreferences() }, t.customize),
        showRejectAll ? h('button', { class: 'btn btn-pri', type: 'button', 'data-cf': 'reject', onclick: () => this.handlers.rejectAll() }, t.rejectAll) : null,
        h('button', { class: 'btn btn-pri', type: 'button', 'data-cf': 'accept', onclick: () => this.handlers.acceptAll() }, t.acceptAll),
      ].filter(Boolean) as HTMLElement[];
    } else if (this.model === 'opt_out') {
      body = t.ccpaDescription;
      actions = [
        h('button', { class: 'btn btn-sec', type: 'button', 'data-cf': 'donotsell', onclick: () => this.showPreferences() }, t.doNotSell),
        h('button', { class: 'btn btn-pri', type: 'button', 'data-cf': 'ok', onclick: () => this.handlers.acknowledge() }, t.ok),
      ];
    } else {
      body = t.noticeDescription;
      actions = [
        h('button', { class: 'btn btn-sec', type: 'button', 'data-cf': 'customize', onclick: () => this.showPreferences() }, t.customize),
        h('button', { class: 'btn btn-pri', type: 'button', 'data-cf': 'ok', onclick: () => this.handlers.acknowledge() }, t.ok),
      ];
    }
    const link = this.policyLink();
    const isModal = layout === 'popup';
    this.bannerEl = h(
      'div',
      {
        class: `banner layout-${layout} pos-${position}`,
        role: 'dialog',
        'aria-modal': isModal ? 'true' : 'false',
        'aria-labelledby': titleId,
        'aria-live': 'polite',
      },
      h('div', { class: 'text' }, h('h2', { id: titleId }, t.title), h('p', {}, body), link ? h('div', { class: 'links', style: 'margin-top:6px' }, link) : null),
      h('div', { class: 'actions' }, ...actions),
    );
    if (isModal) {
      this.backdropEl = h('div', { class: 'backdrop' });
      this.wrap.append(this.backdropEl);
    }
    this.wrap.append(this.bannerEl);
    if (isModal) this.focusFirst(this.bannerEl);
  }

  hideBanner(): void {
    this.bannerEl?.remove();
    this.backdropEl?.remove();
    this.bannerEl = this.backdropEl = null;
  }

  isBannerVisible(): boolean {
    return !!this.bannerEl;
  }

  showPreferences(): void {
    this.hidePreferences();
    this.lastFocus = document.activeElement;
    const t = this.t;
    const current = this.getChoices();
    const toggles = new Map<OptionalCategory, HTMLInputElement>();
    const cats = CATEGORIES.map((cat) => {
      const meta = t.categories[cat];
      const cookies = this.cfg.cookies[cat] ?? [];
      let control: HTMLElement;
      if (cat === 'necessary') control = h('span', { class: 'always' }, t.alwaysActive);
      else {
        const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': meta.name, 'data-cat': cat }) as HTMLInputElement;
        input.checked = current[cat as OptionalCategory];
        toggles.set(cat as OptionalCategory, input);
        control = h('label', { class: 'switch' }, input, h('span'));
      }
      return h(
        'div',
        { class: 'cat' },
        h('div', { class: 'cat-h' }, h('b', {}, meta.name), control),
        h('p', {}, meta.description),
        cookies.length ? this.cookieDetails(cookies, cat) : null,
      );
    });
    const read = (): ConsentChoices => {
      const c = { ...current };
      toggles.forEach((input, cat) => (c[cat] = input.checked));
      return c;
    };
    const link = this.policyLink();
    const titleId = 'cf-pref-title';
    this.modalEl = h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h(
        'header',
        {},
        h('h2', { id: titleId }, t.preferencesTitle),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: () => this.hidePreferences() }, '×'),
      ),
      h('div', { class: 'body' }, h('p', { style: 'margin:0 0 4px' }, t.preferencesDescription), ...cats, link ? h('div', { class: 'links' }, link) : null),
      h(
        'footer',
        { class: 'actions' },
        h('button', { class: 'btn btn-pri', type: 'button', 'data-cf': 'pref-reject', onclick: () => this.handlers.rejectAll() }, t.rejectAll),
        h('button', { class: 'btn btn-sec', type: 'button', 'data-cf': 'pref-save', onclick: () => this.handlers.save(read()) }, t.save),
        h('button', { class: 'btn btn-pri', type: 'button', 'data-cf': 'pref-accept', onclick: () => this.handlers.acceptAll() }, t.acceptAll),
      ),
    );
    if (!this.backdropEl) {
      this.backdropEl = h('div', { class: 'backdrop', onclick: () => this.hidePreferences() });
      this.wrap.append(this.backdropEl);
    }
    this.wrap.append(this.modalEl);
    this.focusFirst(this.modalEl);
  }

  private cookieDetails(cookies: PublicConfig['cookies'][Category], _cat: Category): HTMLElement {
    const t = this.t;
    const rows = cookies.map((c) =>
      h('tr', {}, h('td', {}, c.name), h('td', {}, c.provider || t.table.firstParty), h('td', {}, c.purpose || ''), h('td', {}, c.retention || '')),
    );
    return h(
      'details',
      {},
      h('summary', {}, `${t.cookiesUsed} (${cookies.length})`),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, t.table.name), h('th', {}, t.table.provider), h('th', {}, t.table.purpose), h('th', {}, t.table.expiry))), h('tbody', {}, ...rows)),
    );
  }

  hidePreferences(): void {
    if (!this.modalEl) return;
    this.modalEl.remove();
    this.modalEl = null;
    if (!this.bannerEl || this.cfg.banner.layout !== 'popup') {
      this.backdropEl?.remove();
      this.backdropEl = null;
    }
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus();
  }

  showFab(): void {
    if (!this.cfg.banner.showFloatingButton || this.fabEl) return;
    this.fabEl = h('button', { class: 'fab', type: 'button', 'aria-label': this.t.floatingButton, title: this.t.floatingButton, onclick: () => this.showPreferences() });
    this.fabEl.innerHTML = COOKIE_ICON;
    this.wrap.append(this.fabEl);
  }

  hideFab(): void {
    this.fabEl?.remove();
    this.fabEl = null;
  }

  closeAll(): void {
    this.hidePreferences();
    this.hideBanner();
    this.showFab();
  }

  private focusFirst(el: HTMLElement): void {
    const b = el.querySelector<HTMLElement>('button, input, a[href]');
    setTimeout(() => b?.focus(), 0);
  }

  destroy(): void {
    this.host.remove();
  }
}

export { OPTIONAL_CATEGORIES };
