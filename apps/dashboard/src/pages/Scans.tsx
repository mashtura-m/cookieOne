import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Scan, type ScanDetail } from '../api';
import { can } from '../auth';
import { useResource } from '../hooks';
import { Button, Card, CatPill, Empty, ErrorNote, Loading, StatusPill, fmtDate, useToast } from '../components/ui';
import { useDomain } from './DomainLayout';

const active = (s: { status: string }) => s.status === 'queued' || s.status === 'running';

export function ScansPage() {
  const { domain } = useDomain();
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useResource<Scan[]>(`/api/domains/${domain.id}/scans`, {
    pollMs: (d) => (d?.some(active) ? 3000 : null),
  });
  const start = async () => {
    setBusy(true);
    try {
      await api(`/api/domains/${domain.id}/scans`, { method: 'POST' });
      toast('Scan queued. It usually takes a few minutes.');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Scans"
      actions={can(domain.role, 'editor') ? <Button variant="primary" busy={busy} disabled={data?.some(active)} onClick={start}>Scan now</Button> : null}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        The scanner visits up to {domain.scan_page_limit} pages of {domain.hostname} like a first-time visitor who has not made a choice, and records every
        cookie, storage key, script, iframe and pixel. Automatic scans run {domain.scan_frequency === 'off' ? 'never (turned off in settings)' : domain.scan_frequency}.
      </p>
      <ErrorNote error={error} />
      {!data ? <Loading /> : !data.length ? (
        <Empty title="No scans yet">Run your first scan to build the cookie inventory.</Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Status</th><th>Started</th><th>Trigger</th><th className="num">Pages</th><th className="num">Cookies</th><th className="num">New items</th><th>Note</th></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => nav(s.id)}>
                  <td><StatusPill status={s.status} /></td>
                  <td>{fmtDate(s.started_at ?? s.queued_at)}</td>
                  <td>{s.trigger}{s.requested_by_name ? ` · ${s.requested_by_name}` : ''}</td>
                  <td className="num">{s.pages_scanned}/{s.page_limit}</td>
                  <td className="num">{s.cookies_found}</td>
                  <td className="num">{s.new_items}</td>
                  <td className="trunc muted" title={s.error ?? ''}>{s.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const KIND_LABEL: Record<string, string> = { cookie: 'Cookies', local_storage: 'Local storage', session_storage: 'Session storage', script: 'Third-party scripts', iframe: 'Iframes', pixel: 'Tracking pixels' };

export function ScanDetailPage() {
  const { scanId } = useParams();
  const { data, error } = useResource<ScanDetail>(`/api/scans/${scanId}`, { pollMs: (d) => (d && active(d) ? 3000 : null) });
  const groups = useMemo(() => {
    const m = new Map<string, ScanDetail['findings']>();
    for (const f of data?.findings ?? []) m.set(f.kind, [...(m.get(f.kind) ?? []), f]);
    return [...m.entries()];
  }, [data]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const tracking = data.findings.filter((f) => f.set_before_consent && ['statistics', 'marketing', 'unclassified'].includes(f.category) && (f.kind === 'cookie' || f.kind === 'pixel'));
  return (
    <div className="stack">
      <p><Link to="..">← All scans</Link></p>
      <Card title={<span className="row">Scan <StatusPill status={data.status} /></span>}>
        <p className="muted" style={{ marginTop: 0 }}>
          Queued {fmtDate(data.queued_at)} · finished {fmtDate(data.finished_at)} · {data.pages_scanned} pages · {data.cookies_found} cookies · {data.new_items} new items
        </p>
        {data.error ? <div className="alert alert-bad">{data.error}</div> : null}
        {data.status === 'completed' && tracking.length ? (
          <div className="alert alert-warn">{tracking.length} statistics, marketing or unclassified cookie(s) were set before the visitor made a choice. Categorize them and make sure the scripts that set them are blocked.</div>
        ) : null}
        {data.status === 'completed' && !tracking.length ? <div className="alert alert-good">No tracking cookies were set before consent.</div> : null}
      </Card>
      {groups.map(([kind, items]) => (
        <Card key={kind} title={`${KIND_LABEL[kind] ?? kind} (${items.length})`}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Provider</th><th>Category</th><th>Vendor</th><th>First seen on</th></tr></thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.id}>
                    <td className="mono trunc" title={f.name}>{f.name}</td>
                    <td>{f.provider_domain || <span className="muted">This site</span>}</td>
                    <td><CatPill cat={f.category} /></td>
                    <td>{f.vendor ?? <span className="muted">Unknown</span>}</td>
                    <td className="trunc muted" title={f.first_seen_url ?? ''}>{f.first_seen_url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {data.pages.length ? (
        <Card title={`Pages visited (${data.pages.length})`}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>URL</th><th>Status</th></tr></thead>
              <tbody>{data.pages.map((p, i) => <tr key={i}><td className="trunc">{p.url}</td><td>{p.error ? <span className="pill pill-bad" title={p.error}>Error</span> : p.status_code}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
