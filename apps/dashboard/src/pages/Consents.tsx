import { useState } from 'react';
import { download, type ConsentRow } from '../api';
import { useResource } from '../hooks';
import { Button, Card, Empty, ErrorNote, Field, Loading, fmtDate, useToast } from '../components/ui';
import { useDomain } from './DomainLayout';

const ACTION_LABEL: Record<string, string> = {
  accept_all: 'Accept all', reject_all: 'Reject all', custom: 'Custom', withdraw: 'Withdrawn', gpc_opt_out: 'GPC opt-out', implied: 'Notice acknowledged',
};
const ACTION_CLASS: Record<string, string> = { accept_all: 'pill-good', reject_all: 'pill-bad', withdraw: 'pill-bad', gpc_opt_out: 'pill-warn' };

export function ConsentsPage() {
  const { domain } = useDomain();
  const toast = useToast();
  const [filters, setFilters] = useState({ q: '', action: '', country: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...applied, page: String(page), pageSize: '50' }).filter(([, v]) => v)).toString();
  const { data, error, loading } = useResource<{ rows: ConsentRow[]; total: number; page: number; pageSize: number }>(`/api/domains/${domain.id}/consents?${qs}`);
  const [exporting, setExporting] = useState(false);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const q = new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString();
      await download(`/api/domains/${domain.id}/consents/export.csv?${q}`, `consents-${domain.hostname}.csv`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card title="Consent log" actions={<Button busy={exporting} onClick={exportCsv}>Export CSV</Button>}>
      <p className="muted" style={{ marginTop: 0 }}>
        Every decision is stored with a pseudonymous consent ID, the banner version, the visitor's country and a truncated IP address. This is your proof of consent.
        Visitors see their consent ID in the cookie declaration, so you can look it up here when they ask.
      </p>
      <form className="form-grid" style={{ marginBottom: 14, alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(filters); }}>
        <Field label="Consent ID or page URL" htmlFor="q"><input id="q" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="7c9e6679-…" /></Field>
        <Field label="Decision" htmlFor="action">
          <select id="action" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
            <option value="">All decisions</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Country" htmlFor="country"><input id="country" maxLength={2} value={filters.country} onChange={(e) => setFilters({ ...filters, country: e.target.value.toUpperCase() })} placeholder="DE" /></Field>
        <Field label="From" htmlFor="from"><input id="from" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
        <Field label="To" htmlFor="to"><input id="to" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
        <div><Button variant="primary" type="submit">Apply filters</Button></div>
      </form>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : !data?.rows.length ? (
        <Empty title="No consent records match">Records appear here once the banner is installed and visitors make a choice.</Empty>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Decision</th><th>Preferences</th><th>Statistics</th><th>Marketing</th><th>Rule</th><th>Country</th><th>Consent ID</th><th>Banner</th><th>IP</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)}</td>
                    <td><span className={`pill ${ACTION_CLASS[r.action] ?? ''}`}>{ACTION_LABEL[r.action] ?? r.action}</span>{r.gpc ? <span className="pill pill-warn" style={{ marginLeft: 4 }}>GPC</span> : null}</td>
                    {(['preferences', 'statistics', 'marketing'] as const).map((c) => <td key={c}>{r[c] ? '✓' : <span className="muted">✕</span>}</td>)}
                    <td>{r.regulation.toUpperCase()}</td>
                    <td>{r.country ?? '—'}{r.region ? `-${r.region}` : ''}</td>
                    <td className="mono" title={r.consent_id}>{r.consent_id.slice(0, 8)}…</td>
                    <td>v{r.banner_version}</td>
                    <td className="mono muted">{r.ip_truncated ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <span className="muted">{data.total.toLocaleString()} records · page {data.page} of {pages}</span>
            <div className="row">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
