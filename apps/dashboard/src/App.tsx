import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth, can } from './auth';
import { Loading } from './components/ui';
import { useResource } from './hooks';
import type { DomainListItem } from './api';
import { LoginPage, RegisterPage, InvitePage } from './pages/Auth';
import { DomainsPage } from './pages/Domains';
import { DomainLayout } from './pages/DomainLayout';
import { OverviewPage } from './pages/Overview';
import { ScansPage, ScanDetailPage } from './pages/Scans';
import { CookiesPage } from './pages/Cookies';
import { BannerPage } from './pages/Banner';
import { GeoRulesPage } from './pages/GeoRules';
import { ConsentsPage } from './pages/Consents';
import { SettingsPage } from './pages/Settings';
import { TeamPage } from './pages/Team';
import { AuditPage } from './pages/Audit';

function Shell() {
  const { me, org, setOrgId, signOut } = useAuth();
  const navigate = useNavigate();
  const domains = useResource<DomainListItem[]>(org ? `/api/orgs/${org.id}/domains` : null);
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <NavLink to="/" className="brand"><img src="/favicon.svg" alt="" />ConsentFlow</NavLink>
        {me && me.orgs.length > 1 ? (
          <select aria-label="Workspace" value={org?.id} onChange={(e) => { setOrgId(e.target.value); navigate('/'); }}>
            {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : null}
        <NavLink to="/" end className="nav">All domains</NavLink>
        <div className="nav-l">Domains</div>
        {domains.data?.map((d) => (
          <NavLink key={d.id} to={`/domains/${d.id}`} className="nav" title={d.hostname}>{d.hostname}</NavLink>
        ))}
        <div className="nav-l">Workspace</div>
        <NavLink to="/team" className="nav">Team</NavLink>
        {can(org?.role, 'admin') ? <NavLink to="/audit" className="nav">Audit log</NavLink> : null}
        <div className="side-foot">
          <span>{me?.user.name}</span>
          <span>{org?.name} · {org?.role}</span>
          <button className="btn btn-sm" onClick={() => { signOut(); navigate('/login'); }}>Sign out</button>
        </div>
      </nav>
      <main className="main">
        <Outlet context={{ reloadDomains: domains.reload }} />
      </main>
    </div>
  );
}

function RequireAuth() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return <Shell />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<DomainsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="domains/:domainId" element={<DomainLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="scans" element={<ScansPage />} />
          <Route path="scans/:scanId" element={<ScanDetailPage />} />
          <Route path="cookies" element={<CookiesPage />} />
          <Route path="banner" element={<BannerPage />} />
          <Route path="geo" element={<GeoRulesPage />} />
          <Route path="consents" element={<ConsentsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
