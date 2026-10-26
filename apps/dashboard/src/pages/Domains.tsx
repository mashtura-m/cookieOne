import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api, type DomainListItem } from '../api';
import { can, useAuth } from '../auth';
import { useResource } from '../hooks';
import { Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, StatusPill, fmtDate, useToast } from '../components/ui';

export function DomainsPage() {
  const { org } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { reloadDomains } = useOutletContext<{ reloadDomains(): void }>();
  const { data, error, loading, reload } = useResource<DomainListItem[]>(org ? `/api/orgs/${org.id}/domains` : null);
  const [adding, setAdding] = useState(false);
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const d = await api<{ id: string; hostname: string }>(`/api/orgs/${org!.id}/domains`, { method: 'POST', body: { hostname } });
      toast(`${d.hostname} added`);
      setAdding(false);
      setHostname('');
      reload();
      reloadDomains();
      nav(`/domains/${d.id}`);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Domains"
        sub="Each website gets its own banner, cookie inventory, geo rules and consent log."
        actions={can(org?.role, 'admin') ? <Button variant="primary" onClick={() => setAdding(true)}>Add domain</Button> : null}
      />
      <ErrorNote error={error} />
      <Card>
        {loading ? <Loading /> : !data?.length ? (
          <Empty title="No domains yet">
            <p>Add your website to scan it for cookies and get the banner script.</p>
            {can(org?.role, 'admin') ? <Button variant="primary" onClick={() => setAdding(true)}>Add your first domain</Button> : null}
          </Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Domain</th><th>Last scan</th><th className="num">Cookies</th><th className="num">Unclassified</th><th className="num">Consents (30 days)</th></tr></thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => nav(`/domains/${d.id}`)}>
                    <td><b>{d.hostname}</b></td>
                    <td>{d.last_scan ? <span className="row"><StatusPill status={d.last_scan.status} /><span className="muted">{fmtDate(d.last_scan.finished_at, false)}</span></span> : <span className="muted">Never scanned</span>}</td>
                    <td className="num">{d.cookie_count}</td>
                    <td className="num">{d.unclassified_count ? <span className="pill cat-unclassified">{d.unclassified_count}</span> : 0}</td>
                    <td className="num">{d.consents_30d.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {adding ? (
        <Modal
          title="Add a domain"
          onClose={() => setAdding(false)}
          footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" busy={busy} onClick={add} disabled={!hostname.trim()}>Add domain</Button></>}
        >
          <ErrorNote error={formError} />
          <Field label="Website address" htmlFor="hostname" hint="We create a default banner and geo rules. You can scan the site right after.">
            <input id="hostname" autoFocus placeholder="www.example.com" value={hostname} onChange={(e) => setHostname(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && hostname.trim() && add()} />
          </Field>
        </Modal>
      ) : null}
    </>
  );
}
