import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import type { Domain } from '../api';
import { useResource } from '../hooks';
import { ErrorNote, Loading } from '../components/ui';

export interface DomainCtx {
  domain: Domain;
  reloadDomain(): void;
  reloadDomains(): void;
}

export function useDomain(): DomainCtx {
  return useOutletContext<DomainCtx>();
}

const TABS = [
  ['', 'Overview'],
  ['scans', 'Scans'],
  ['cookies', 'Cookies & scripts'],
  ['banner', 'Banner'],
  ['geo', 'Geo rules'],
  ['consents', 'Consent log'],
  ['settings', 'Settings & install'],
] as const;

export function DomainLayout() {
  const { domainId } = useParams();
  const { reloadDomains } = useOutletContext<{ reloadDomains(): void }>();
  const { data, error, reload } = useResource<Domain>(`/api/domains/${domainId}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{data.hostname}</h1>
          <p className="sub">Your role: {data.role}</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Domain sections">
        {TABS.map(([path, label]) => (
          <NavLink key={path} end={path === ''} to={`/domains/${domainId}${path ? '/' + path : ''}`} className="tab">{label}</NavLink>
        ))}
      </nav>
      <Outlet context={{ domain: data, reloadDomain: reload, reloadDomains } satisfies DomainCtx} />
    </>
  );
}
