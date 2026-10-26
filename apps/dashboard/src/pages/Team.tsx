import { useState } from 'react';
import { api, type Invitation, type Member, type Role } from '../api';
import { can, useAuth } from '../auth';
import { useResource } from '../hooks';
import { Button, Card, CopyBox, ErrorNote, Field, Loading, PageHeader, fmtDate, useToast } from '../components/ui';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including managing owners',
  admin: 'Manage team, add and delete domains',
  editor: 'Edit banners, cookies, rules; run scans',
  viewer: 'Read only',
};

export function TeamPage() {
  const { org, me, refresh } = useAuth();
  const toast = useToast();
  const isAdmin = can(org?.role, 'admin');
  const res = useResource<{ members: Member[]; invitations: Invitation[] }>(org ? `/api/orgs/${org.id}/members` : null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState(org?.name ?? '');

  const invite = async () => {
    setError(null);
    try {
      const r = await api<{ inviteUrl: string }>(`/api/orgs/${org!.id}/invitations`, { method: 'POST', body: { email, role } });
      setLink(r.inviteUrl);
      setEmail('');
      res.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      res.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <>
      <PageHeader title="Team" sub={`People in ${org?.name}`} />
      <div className="grid-2-1">
        <Card title="Members">
          {!res.data ? <Loading /> : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th></th></tr></thead>
                <tbody>
                  {res.data.members.map((m) => (
                    <tr key={m.id}>
                      <td><b>{m.name}</b><div className="muted" style={{ fontSize: 12 }}>{m.email}</div></td>
                      <td>
                        {isAdmin && m.id !== me?.user.id ? (
                          <select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => act(() => api(`/api/orgs/${org!.id}/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'Role updated')}>
                            {(Object.keys(ROLE_HELP) as Role[]).map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        ) : m.role}
                      </td>
                      <td className="muted">{fmtDate(m.last_login_at)}</td>
                      <td>{isAdmin && m.id !== me?.user.id ? <Button size="sm" variant="ghost" className="btn-danger" onClick={() => act(() => api(`/api/orgs/${org!.id}/members/${m.id}`, { method: 'DELETE' }), `${m.name} removed`)}>Remove</Button> : null}</td>
                    </tr>
                  ))}
                  {res.data.invitations.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}<div className="muted" style={{ fontSize: 12 }}>Invited, expires {fmtDate(i.expires_at, false)}</div></td>
                      <td>{i.role}</td>
                      <td className="muted">Pending</td>
                      <td>{isAdmin ? <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/orgs/${org!.id}/invitations/${i.id}`, { method: 'DELETE' }), 'Invitation cancelled')}>Cancel</Button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="stack">
          {isAdmin ? (
            <Card title="Invite someone">
              <ErrorNote error={error} />
              <div className="stack" style={{ gap: 12 }}>
                <Field label="Email" htmlFor="inv-email"><input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" /></Field>
                <Field label="Role" htmlFor="inv-role" hint={ROLE_HELP[role]}>
                  <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    {(Object.keys(ROLE_HELP) as Role[]).filter((r) => r !== 'owner' || org?.role === 'owner').map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
                <Button variant="primary" disabled={!email.includes('@')} onClick={invite}>Create invitation</Button>
                {link ? <CopyBox label="Send this link to your colleague. It works for 7 days." value={link} /> : null}
              </div>
            </Card>
          ) : null}
          {isAdmin ? (
            <Card title="Workspace">
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Name" htmlFor="org-name"><input id="org-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} /></Field>
                <Button onClick={() => act(async () => { await api(`/api/orgs/${org!.id}`, { method: 'PATCH', body: { name: orgName } }); await refresh(); }, 'Workspace renamed')}>Rename</Button>
              </div>
            </Card>
          ) : null}
          <Card title="Roles">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(Object.keys(ROLE_HELP) as Role[]).map((r) => <li key={r}><b>{r}</b>: {ROLE_HELP[r]}</li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
