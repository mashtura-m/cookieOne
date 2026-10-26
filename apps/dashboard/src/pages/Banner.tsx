import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_TEXTS, DEFAULT_THEME, SUPPORTED_LANGUAGES, type PublicConfig } from '@consentflow/shared';
import { API_URL, api, type BannerConfig, type BannerTheme } from '../api';
import { can } from '../auth';
import { useResource } from '../hooks';
import { Button, Card, ErrorNote, Field, Loading, fmtDate, useToast } from '../components/ui';
import { useDomain } from './DomainLayout';

type Editable = Pick<BannerConfig, 'layout' | 'position' | 'theme' | 'texts' | 'languages' | 'defaultLanguage' | 'showRejectAll' | 'showFloatingButton' | 'customCss'>;

const LANG_NAMES: Record<string, string> = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español' };
const TEXT_FIELDS: { key: string; label: string; long?: boolean }[] = [
  { key: 'title', label: 'Title' },
  { key: 'description', label: 'Description (GDPR banner)', long: true },
  { key: 'acceptAll', label: 'Accept all button' },
  { key: 'rejectAll', label: 'Reject all button' },
  { key: 'customize', label: 'Customize button' },
  { key: 'save', label: 'Save choices button' },
  { key: 'preferencesTitle', label: 'Preference center title' },
  { key: 'ccpaDescription', label: 'Description (CCPA banner)', long: true },
  { key: 'doNotSell', label: 'Do Not Sell link' },
  { key: 'noticeDescription', label: 'Description (notice only)', long: true },
];
const REGIONS = [
  { id: 'DE', label: 'EU visitor (GDPR)', country: 'DE', region: '' },
  { id: 'US-CA', label: 'California (CCPA)', country: 'US', region: 'CA' },
  { id: 'BR', label: 'Brazil (LGPD)', country: 'BR', region: '' },
  { id: 'JP', label: 'Rest of world', country: 'JP', region: '' },
];
const COLOR_FIELDS: { key: keyof BannerTheme; label: string }[] = [
  { key: 'background', label: 'Background' }, { key: 'text', label: 'Text' },
  { key: 'primary', label: 'Primary button' }, { key: 'primaryText', label: 'Primary button text' },
  { key: 'secondary', label: 'Secondary button' }, { key: 'secondaryText', label: 'Secondary button text' },
];

function pick(b: BannerConfig): Editable {
  return {
    layout: b.layout, position: b.position, theme: { ...DEFAULT_THEME, ...b.theme }, texts: b.texts ?? {}, languages: b.languages,
    defaultLanguage: b.defaultLanguage, showRejectAll: b.showRejectAll, showFloatingButton: b.showFloatingButton, customCss: b.customCss,
  };
}

function previewHtml(cfg: PublicConfig, lang: string): string {
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:15px/1.6 system-ui,sans-serif;color:#2b3445;background:#f5f6f8}header{background:#fff;border-bottom:1px solid #e3e6ec;padding:16px 28px;font-weight:700}
main{padding:28px;max-width:760px}.blk{background:#e6e9ef;border-radius:8px;height:14px;margin:10px 0}.hero{height:150px;border-radius:12px;background:linear-gradient(120deg,#dfe5ef,#eef1f6);margin:18px 0}</style>
<script>window.__CF_CONFIG__=${json};</script><script src="${API_URL}/v1/cmp-core.js" data-lang="${lang}"></script></head>
<body><header>${cfg.banner.layout === 'bar' && cfg.banner.position === 'top' ? '' : 'yourwebsite.com'}</header><main><h1>Welcome to your website</h1><div class="hero"></div>
<div class="blk" style="width:92%"></div><div class="blk" style="width:80%"></div><div class="blk" style="width:86%"></div><div class="blk" style="width:60%"></div></main></body></html>`;
}

export function BannerPage() {
  const { domain } = useDomain();
  const toast = useToast();
  const editable = can(domain.role, 'editor');
  const res = useResource<{ draft: BannerConfig | null; published: BannerConfig | null }>(`/api/domains/${domain.id}/banner`);
  const versions = useResource<BannerConfig[]>(`/api/domains/${domain.id}/banner/versions`);
  const [form, setForm] = useState<Editable | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [region, setRegion] = useState(REGIONS[0]);
  const [lang, setLang] = useState('en');
  const [textLang, setTextLang] = useState('en');
  const [base, setBase] = useState<PublicConfig | null>(null);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [srcDoc, setSrcDoc] = useState('');

  useEffect(() => {
    const b = res.data?.draft ?? res.data?.published;
    if (b && !form) {
      const f = pick(b);
      setForm(f);
      setSaved(JSON.stringify(f));
      setLang(f.defaultLanguage);
      setTextLang(f.defaultLanguage);
    }
  }, [res.data, form]);

  useEffect(() => {
    api<PublicConfig>(`/api/domains/${domain.id}/banner/preview-config?country=${region.country}&region=${region.region}`).then(setBase).catch(() => setBase(null));
  }, [domain.id, region]);

  const previewCfg = useMemo<PublicConfig | null>(() => {
    if (!base || !form) return null;
    return {
      ...base,
      preview: true,
      banner: {
        layout: form.layout, position: form.position, theme: { ...DEFAULT_THEME, ...form.theme } as PublicConfig['banner']['theme'],
        texts: form.texts as PublicConfig['banner']['texts'], languages: form.languages, defaultLanguage: form.defaultLanguage,
        showRejectAll: form.showRejectAll, showFloatingButton: form.showFloatingButton, customCss: form.customCss,
      },
    };
  }, [base, form]);

  useEffect(() => {
    if (!previewCfg) return;
    const t = setTimeout(() => setSrcDoc(previewHtml(previewCfg, form?.languages.includes(lang) ? lang : form?.defaultLanguage ?? 'en')), 250);
    return () => clearTimeout(t);
  }, [previewCfg, lang, form]);

  if (res.error) return <ErrorNote error={res.error} />;
  if (!form) return <Loading />;

  const dirty = JSON.stringify(form) !== saved;
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setForm({ ...form, [k]: v });
  const setTheme = (k: keyof BannerTheme, v: string | number) => set('theme', { ...form.theme, [k]: v });
  const setText = (key: string, value: string) => {
    const forLang = { ...(form.texts[textLang] ?? {}) };
    if (value) forLang[key] = value;
    else delete forLang[key];
    set('texts', { ...form.texts, [textLang]: forLang });
  };
  const toggleLang = (l: string) => {
    const langs = form.languages.includes(l) ? form.languages.filter((x) => x !== l) : [...form.languages, l];
    if (!langs.length) return;
    setForm({ ...form, languages: langs, defaultLanguage: langs.includes(form.defaultLanguage) ? form.defaultLanguage : langs[0] });
    if (!langs.includes(textLang)) setTextLang(langs[0]);
  };

  const save = async () => {
    setBusy('save');
    try {
      await api(`/api/domains/${domain.id}/banner`, { method: 'PUT', body: form });
      setSaved(JSON.stringify(form));
      toast('Draft saved. Visitors still see the published version.');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };
  const publish = async () => {
    setBusy('publish');
    try {
      if (dirty) {
        await api(`/api/domains/${domain.id}/banner`, { method: 'PUT', body: form });
        setSaved(JSON.stringify(form));
      }
      const p = await api<BannerConfig>(`/api/domains/${domain.id}/banner/publish`, { method: 'POST' });
      toast(`Version ${p.version} is live. Visitors will be asked again.`);
      await res.reload();
      versions.reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const defaults = DEFAULT_TEXTS[textLang] ?? DEFAULT_TEXTS.en;
  const published = res.data?.published;

  return (
    <div className="builder">
      <div className="stack">
        <Card
          title="Banner"
          actions={editable ? (
            <>
              <Button busy={busy === 'save'} disabled={!dirty || !!busy} onClick={save}>Save draft</Button>
              <Button variant="primary" busy={busy === 'publish'} disabled={!!busy} onClick={publish}>Publish</Button>
            </>
          ) : null}
        >
          <p className="muted" style={{ marginTop: 0 }}>
            Live: version {published?.version ?? '—'}{published?.publishedAt ? `, published ${fmtDate(published.publishedAt)}` : ''}.{' '}
            {dirty ? 'You have unsaved changes.' : res.data?.draft ? `Editing draft version ${res.data.draft.version}.` : ''} Publishing asks every visitor for consent again.
          </p>
          {!form.showRejectAll ? <div className="alert alert-warn">EU regulators expect “Reject all” on the first layer, as visible as “Accept all”. Hiding it fails the compliance check.</div> : null}

          <details className="section" open>
            <summary>Layout</summary>
            <div className="stack" style={{ gap: 12 }}>
              <Field label="Style">
                <div className="seg" role="group" aria-label="Layout">
                  {(['box', 'bar', 'popup'] as const).map((l) => <button key={l} className={form.layout === l ? 'on' : ''} disabled={!editable} onClick={() => set('layout', l)}>{l === 'box' ? 'Box' : l === 'bar' ? 'Full-width bar' : 'Centered popup'}</button>)}
                </div>
              </Field>
              {form.layout !== 'popup' ? (
                <Field label="Position" htmlFor="pos">
                  <select id="pos" value={form.position} disabled={!editable} onChange={(e) => set('position', e.target.value as Editable['position'])}>
                    {form.layout === 'bar'
                      ? <><option value="bottom">Bottom</option><option value="top">Top</option></>
                      : <><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option><option value="center">Center</option></>}
                  </select>
                </Field>
              ) : null}
              <label className="check"><input type="checkbox" checked={form.showRejectAll} disabled={!editable} onChange={(e) => set('showRejectAll', e.target.checked)} /> Show “Reject all” on the first layer</label>
              <label className="check"><input type="checkbox" checked={form.showFloatingButton} disabled={!editable} onChange={(e) => set('showFloatingButton', e.target.checked)} /> Show a floating button so visitors can change their choice later</label>
            </div>
          </details>

          <details className="section">
            <summary>Colors and font</summary>
            <div className="colors">
              {COLOR_FIELDS.map((c) => (
                <Field key={c.key} label={c.label}>
                  <div className="color-field">
                    <input type="color" aria-label={c.label} value={String(form.theme[c.key] ?? '#000000').slice(0, 7)} disabled={!editable} onChange={(e) => setTheme(c.key, e.target.value)} />
                    <input type="text" className="input" aria-label={`${c.label} hex`} value={String(form.theme[c.key] ?? '')} disabled={!editable} onChange={(e) => setTheme(c.key, e.target.value)} />
                  </div>
                </Field>
              ))}
            </div>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label={`Corner radius (${form.theme.radius ?? 10}px)`} htmlFor="radius"><input id="radius" type="range" min={0} max={24} value={Number(form.theme.radius ?? 10)} disabled={!editable} onChange={(e) => setTheme('radius', Number(e.target.value))} /></Field>
              <Field label="Font family" htmlFor="font"><input id="font" value={String(form.theme.fontFamily ?? '')} disabled={!editable} onChange={(e) => setTheme('fontFamily', e.target.value)} /></Field>
            </div>
          </details>

          <details className="section">
            <summary>Languages and text</summary>
            <div className="stack" style={{ gap: 12 }}>
              <Field label="Languages" hint="The banner uses the visitor's browser language when it is in this list.">
                <div className="row">
                  {SUPPORTED_LANGUAGES.map((l) => <label key={l} className="check"><input type="checkbox" checked={form.languages.includes(l)} disabled={!editable} onChange={() => toggleLang(l)} />{LANG_NAMES[l] ?? l}</label>)}
                </div>
              </Field>
              <Field label="Default language" htmlFor="deflang">
                <select id="deflang" value={form.defaultLanguage} disabled={!editable} onChange={(e) => set('defaultLanguage', e.target.value)}>
                  {form.languages.map((l) => <option key={l} value={l}>{LANG_NAMES[l] ?? l}</option>)}
                </select>
              </Field>
              <div className="seg" role="group" aria-label="Edit text for language">
                {form.languages.map((l) => <button key={l} className={textLang === l ? 'on' : ''} onClick={() => { setTextLang(l); setLang(l); }}>{LANG_NAMES[l] ?? l}</button>)}
              </div>
              <p className="hint" style={{ margin: 0 }}>Leave a field empty to use the built-in translation shown as the placeholder.</p>
              {TEXT_FIELDS.map((f) => {
                const value = String((form.texts[textLang] ?? {})[f.key] ?? '');
                const ph = String((defaults as unknown as Record<string, unknown>)[f.key] ?? '');
                return (
                  <Field key={f.key} label={f.label} htmlFor={`t-${f.key}`}>
                    {f.long
                      ? <textarea id={`t-${f.key}`} rows={3} value={value} placeholder={ph} disabled={!editable} onChange={(e) => setText(f.key, e.target.value)} />
                      : <input id={`t-${f.key}`} value={value} placeholder={ph} disabled={!editable} onChange={(e) => setText(f.key, e.target.value)} />}
                  </Field>
                );
              })}
            </div>
          </details>

          <details className="section">
            <summary>Custom CSS</summary>
            <Field label="CSS inside the banner's shadow root" hint="Target .banner, .btn-pri, .btn-sec, .modal, .fab.">
              <textarea rows={6} className="mono" value={form.customCss} disabled={!editable} onChange={(e) => set('customCss', e.target.value)} placeholder=".banner { box-shadow: none; }" />
            </Field>
          </details>
        </Card>

        <Card title="Version history">
          {!versions.data ? <Loading /> : (
            <table className="tbl">
              <thead><tr><th>Version</th><th>Status</th><th>Created</th><th>Published</th></tr></thead>
              <tbody>
                {versions.data.map((v) => (
                  <tr key={v.id}><td>v{v.version}</td><td><span className={`pill ${v.status === 'published' ? 'pill-good' : v.status === 'draft' ? 'pill-warn' : ''}`}>{v.status}</span></td><td>{fmtDate(v.createdAt)}{v.createdByName ? ` · ${v.createdByName}` : ''}</td><td>{fmtDate(v.publishedAt)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="preview">
        <Card
          title="Live preview"
          actions={
            <>
              <select className="input" style={{ width: 'auto' }} aria-label="Preview as visitor from" value={region.id} onChange={(e) => setRegion(REGIONS.find((r) => r.id === e.target.value)!)}>
                {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <select className="input" style={{ width: 'auto' }} aria-label="Preview language" value={lang} onChange={(e) => setLang(e.target.value)}>
                {form.languages.map((l) => <option key={l} value={l}>{LANG_NAMES[l] ?? l}</option>)}
              </select>
              <Button size="sm" onClick={() => setSrcDoc((s) => s + ' ')}>Show again</Button>
            </>
          }
        >
          {base ? (
            <p className="muted" style={{ marginTop: 0 }}>Previewing as: {region.label}. This visitor gets the <b>{base.regulation === 'none' ? 'notice-only' : base.regulation.toUpperCase()}</b> rule ({base.model.replace('_', '-')}). The preview never stores consent.</p>
          ) : null}
          {srcDoc ? <iframe title="Banner preview" className="preview-frame" srcDoc={srcDoc} sandbox="allow-scripts" /> : <Loading />}
        </Card>
      </div>
    </div>
  );
}
