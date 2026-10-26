import type { BannerTexts, PublicConfig } from '@consentflow/shared';
import { CATEGORIES } from '@consentflow/shared';
import type { ConsentFlowApi } from './cmp';
import { h } from './ui';

/**
 * Renders the cookie declaration into <div id="consentflow-declaration"></div> on the site's
 * privacy page. Uses plain light-DOM markup with cf-decl-* classes so the site can style it.
 */
export function renderDeclaration(el: HTMLElement, cfg: PublicConfig, t: BannerTexts, api: () => ConsentFlowApi): void {
  el.textContent = '';
  const status = h('p', { class: 'cf-decl-status' });
  const refresh = () => {
    const c = api().getConsent();
    const on = CATEGORIES.filter((k) => c[k]).map((k) => t.categories[k].name);
    const id = api().consentId;
    status.textContent = `${on.join(', ')}${id ? ` · ID ${id}` : ''}`;
  };
  el.append(
    status,
    h('p', {}, h('button', { type: 'button', class: 'cf-decl-change', onclick: () => api().showPreferences() }, t.floatingButton)),
  );
  for (const cat of CATEGORIES) {
    const cookies = cfg.cookies[cat] ?? [];
    el.append(h('h3', { class: 'cf-decl-cat' }, `${t.categories[cat].name} (${cookies.length})`), h('p', {}, t.categories[cat].description));
    if (!cookies.length) continue;
    el.append(
      h(
        'table',
        { class: 'cf-decl-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t.table.name), h('th', {}, t.table.provider), h('th', {}, t.table.purpose), h('th', {}, t.table.expiry))),
        h('tbody', {}, ...cookies.map((c) => h('tr', {}, h('td', {}, c.name), h('td', {}, c.provider || t.table.firstParty), h('td', {}, c.purpose), h('td', {}, c.retention)))),
      ),
    );
  }
  refresh();
  window.addEventListener('consentflow:change', refresh);
}
