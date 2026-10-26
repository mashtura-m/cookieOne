import { useState } from 'react';
import { api, type Cat, type DomainCookie, type DomainScript } from '../api';
import { can } from '../auth';
import { useResource } from '../hooks';
import { Button, Card, CATEGORY_LABEL, Empty, ErrorNote, Field, Loading, Modal, useToast } from '../components/ui';
import { useDomain } from './DomainLayout';

const CATS: Cat[] = ['necessary', 'preferences', 'statistics', 'marketing', 'unclassified'];
const KIND: Record<string, string> = { cookie: 'Cookie', local_storage: 'Local storage', session_storage: 'Session storage', pixel: 'Pixel' };

function CatSelect({ value, onChange, disabled, label }: { value: Cat; onChange(c: Cat): void; disabled?: boolean; label: string }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Cat)} className={`cat-${value}`} style={{ color: 'var(--pc)', fontWeight: 600 }}>
      {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
    </select>
  );
}

type Draft = { id?: string; name: string; kind: string; providerDomain: string; category: Cat; vendor: string; purpose: string; retention: string };
const blank: Draft = { name: '', kind: 'cookie', providerDomain: '', category: 'unclassified', vendor: '', purpose: '', retention: '' };

export function CookiesPage() {
  const { domain } = useDomain();
  const toast = useToast();
  const editable = can(domain.role, 'editor');
  const cookies = useResource<DomainCookie[]>(`/api/domains/${domain.id}/cookies`);
  const scripts = useResource<DomainScript[]>(`/api/domains/${domain.id}/scripts`);
  const [filter, setFilter] = useState<Cat | 'all'>('all');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [scriptDraft, setScriptDraft] = useState<{ urlPattern: string; category: Cat; vendor: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const patchCookie = async (id: string, body: Partial<DomainCookie> | Record<string, unknown>) => {
    try {
      const row = await api<DomainCookie>(`/api/cookies/${id}`, { method: 'PATCH', body });
      cookies.setData((cookies.data ?? []).map((c) => (c.id === id ? row : c)));
      toast('Saved. The banner picks this up within a minute.');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const saveCookie = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    const body = { name: editing.name, providerDomain: editing.providerDomain, category: editing.category, vendor: editing.vendor || null, purpose: editing.purpose || null, retention: editing.retention || null };
    try {
      if (editing.id) await api(`/api/cookies/${editing.id}`, { method: 'PATCH', body });
      else await api(`/api/domains/${domain.id}/cookies`, { method: 'POST', body: { ...body, kind: editing.kind, category: editing.category === 'unclassified' ? undefined : editing.category } });
      setEditing(null);
      cookies.reload();
      toast(editing.id ? 'Cookie updated' : 'Cookie added');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeCookie = async (c: DomainCookie) => {
    try {
      await api(`/api/cookies/${c.id}`, { method: 'DELETE' });
      cookies.setData((cookies.data ?? []).filter((x) => x.id !== c.id));
      toast(`${c.name} removed`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const saveScript = async () => {
    if (!scriptDraft) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/domains/${domain.id}/scripts`, { method: 'POST', body: { ...scriptDraft, vendor: scriptDraft.vendor || null } });
      setScriptDraft(null);
      scripts.reload();
      toast('Blocking rule saved');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const list = (cookies.data ?? []).filter((c) => filter === 'all' || c.category === filter);
  const unclassified = (cookies.data ?? []).filter((c) => c.category === 'unclassified').length;

  return (
    <div className="stack">
      {unclassified ? <div className="alert alert-warn">{unclassified} item(s) are unclassified. The banner treats them as marketing until you pick a category.</div> : null}
      <Card
        title="Cookies and storage"
        actions={
          <>
            <select className="input" style={{ width: 'auto' }} aria-label="Filter by category" value={filter} onChange={(e) => setFilter(e.target.value as Cat | 'all')}>
              <option value="all">All categories</option>
              {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            {editable ? <Button variant="primary" onClick={() => { setErr(null); setEditing({ ...blank }); }}>Add cookie</Button> : null}
          </>
        }
      >
        <ErrorNote error={cookies.error} />
        {!cookies.data ? <Loading /> : !list.length ? <Empty title="Nothing here yet">Run a scan or add cookies by hand.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Type</th><th>Provider</th><th>Category</th><th>Purpose</th><th>Expiry</th><th></th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td><span className="mono">{c.name}</span>{c.vendor ? <div className="muted" style={{ fontSize: 12 }}>{c.vendor}</div> : null}</td>
                    <td className="muted">{KIND[c.kind] ?? c.kind}</td>
                    <td>{c.provider_domain || <span className="muted">This site</span>}</td>
                    <td><CatSelect label={`Category for ${c.name}`} value={c.category} disabled={!editable} onChange={(cat) => patchCookie(c.id, { category: cat })} /></td>
                    <td className="trunc" title={c.purpose ?? ''}>{c.purpose || <span className="muted">No description</span>}</td>
                    <td className="muted">{c.retention ?? '—'}</td>
                    <td>
                      {editable ? (
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <Button size="sm" onClick={() => { setErr(null); setEditing({ id: c.id, name: c.name, kind: c.kind, providerDomain: c.provider_domain, category: c.category, vendor: c.vendor ?? '', purpose: c.purpose ?? '', retention: c.retention ?? '' }); }}>Edit</Button>
                          {c.name !== 'cf_consent' ? <Button size="sm" variant="ghost" className="btn-danger" onClick={() => removeCookie(c)}>Remove</Button> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Script and iframe blocking rules" actions={editable ? <Button onClick={() => { setErr(null); setScriptDraft({ urlPattern: '', category: 'marketing', vendor: '' }); }}>Add rule</Button> : null}>
        <p className="muted" style={{ marginTop: 0 }}>
          Scripts and iframes whose URL contains a pattern below wait until the visitor allows that category. ConsentFlow also blocks dozens of well-known trackers
          automatically. Unclassified scripts are not blocked, so categorize them here.
        </p>
        {!scripts.data ? <Loading /> : !scripts.data.length ? <Empty title="No third-party scripts found yet" /> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>URL pattern</th><th>Vendor</th><th>Category</th><th>Source</th></tr></thead>
              <tbody>
                {scripts.data.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.url_pattern}</td>
                    <td>{s.vendor ?? <span className="muted">Unknown</span>}</td>
                    <td>
                      <CatSelect label={`Category for ${s.url_pattern}`} value={s.category} disabled={!editable} onChange={async (cat) => {
                        try {
                          await api(`/api/scripts/${s.id}`, { method: 'PATCH', body: { category: cat } });
                          scripts.reload();
                          toast('Saved');
                        } catch (e) {
                          toast((e as Error).message, true);
                        }
                      }} />
                    </td>
                    <td className="muted">{s.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing ? (
        <Modal title={editing.id ? `Edit ${editing.name}` : 'Add a cookie'} onClose={() => setEditing(null)}
          footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" busy={busy} disabled={!editing.name.trim()} onClick={saveCookie}>Save</Button></>}>
          <ErrorNote error={err} />
          <div className="form-grid">
            <Field label="Name" htmlFor="c-name" hint={editing.id ? undefined : 'Known cookies are filled in from our library.'}><input id="c-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            {!editing.id ? (
              <Field label="Type" htmlFor="c-kind">
                <select id="c-kind" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                  {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
            ) : null}
            <Field label="Provider domain" htmlFor="c-prov" hint="Leave empty for cookies set by your own site."><input id="c-prov" value={editing.providerDomain} onChange={(e) => setEditing({ ...editing, providerDomain: e.target.value })} placeholder="doubleclick.net" /></Field>
            <Field label="Category" htmlFor="c-cat"><CatSelect label="Category" value={editing.category} onChange={(c) => setEditing({ ...editing, category: c })} /></Field>
            <Field label="Vendor" htmlFor="c-vendor"><input id="c-vendor" value={editing.vendor} onChange={(e) => setEditing({ ...editing, vendor: e.target.value })} /></Field>
            <Field label="Expiry" htmlFor="c-ret"><input id="c-ret" value={editing.retention} onChange={(e) => setEditing({ ...editing, retention: e.target.value })} placeholder="1 year" /></Field>
          </div>
          <Field label="Purpose (shown to visitors)" htmlFor="c-purpose"><textarea id="c-purpose" value={editing.purpose} onChange={(e) => setEditing({ ...editing, purpose: e.target.value })} /></Field>
        </Modal>
      ) : null}

      {scriptDraft ? (
        <Modal title="Add a blocking rule" onClose={() => setScriptDraft(null)}
          footer={<><Button onClick={() => setScriptDraft(null)}>Cancel</Button><Button variant="primary" busy={busy} disabled={scriptDraft.urlPattern.trim().length < 3} onClick={saveScript}>Save rule</Button></>}>
          <ErrorNote error={err} />
          <Field label="URL contains" htmlFor="s-pat" hint="A host or host/path, for example widget.example-chat.com"><input id="s-pat" value={scriptDraft.urlPattern} onChange={(e) => setScriptDraft({ ...scriptDraft, urlPattern: e.target.value })} /></Field>
          <Field label="Category" htmlFor="s-cat"><CatSelect label="Category" value={scriptDraft.category} onChange={(c) => setScriptDraft({ ...scriptDraft, category: c })} /></Field>
          <Field label="Vendor" htmlFor="s-vendor"><input id="s-vendor" value={scriptDraft.vendor} onChange={(e) => setScriptDraft({ ...scriptDraft, vendor: e.target.value })} /></Field>
        </Modal>
      ) : null}
    </div>
  );
}
