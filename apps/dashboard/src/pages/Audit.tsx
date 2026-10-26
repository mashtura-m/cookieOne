import type { AuditEntry } from '../api';
import { useAuth } from '../auth';
import { useResource } from '../hooks';
import { Card, Empty, ErrorNote, Loading, PageHeader, fmtDate } from '../components/ui';

export function AuditPage() {
  const { org } = useAuth();
  const { data, error } = useResource<AuditEntry[]>(org ? `/api/orgs/${org.id}/audit?limit=200` : null);
  return (
    <>
      <PageHeader title="Audit log" sub="Who changed what in this workspace. The latest 200 entries." />
      <ErrorNote error={error} />
      <Card>
        {!data ? <Loading /> : !data.length ? <Empty title="No activity yet" /> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Domain</th><th>Details</th></tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.created_at)}</td>
                    <td>{a.user_name ?? '—'}</td>
                    <td className="mono">{a.action}</td>
                    <td>{a.hostname ?? '—'}</td>
                    <td className="mono trunc muted" title={JSON.stringify(a.details)}>{Object.keys(a.details).length ? JSON.stringify(a.details) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
