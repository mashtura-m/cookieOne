import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Overview, Stats } from '../api';
import { useResource } from '../hooks';
import { Card, CatPill, CopyBox, ErrorNote, Loading, StatusPill, fmtDate, fmtPct, CATEGORY_LABEL } from '../components/ui';
import { DailyChart, ScoreRing } from '../components/Charts';
import { useDomain } from './DomainLayout';

export function OverviewPage() {
  const { domain } = useDomain();
  const [days, setDays] = useState(30);
  const ov = useResource<Overview>(`/api/domains/${domain.id}/overview`);
  const st = useResource<Stats>(`/api/domains/${domain.id}/stats?days=${days}`);
  if (ov.error) return <ErrorNote error={ov.error} />;
  if (!ov.data) return <Loading />;
  const { compliance, lastScan, byCategory, banner } = ov.data;
  const s = st.data;
  const decided = s ? s.totals.accept_all + s.totals.reject_all + s.totals.custom : 0;
  return (
    <div className="stack">
      <div className="grid-2-1">
        <Card title="Compliance checks">
          <div className="score">
            <ScoreRing score={compliance.score} />
            <div>
              <b>{compliance.checks.filter((c) => c.passed).length} of {compliance.checks.length} checks passed</b>
              <p className="muted" style={{ margin: '4px 0 0' }}>These checks catch the most common problems. They are not legal advice.</p>
            </div>
          </div>
          <ul className="checks">
            {compliance.checks.map((c) => (
              <li key={c.id}>
                <span className={`mark ${c.passed ? 'ok' : 'no'}`} aria-label={c.passed ? 'Passed' : 'Failed'}>{c.passed ? '✓' : '!'}</span>
                <span>{c.label}<small>{c.detail}</small></span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="stack">
          <Card title="Install">
            <CopyBox label="Put this first in the <head> of every page" value={domain.install.html} />
            <p className="muted" style={{ margin: 0 }}>More options, including the cookie declaration and WordPress, are under <Link to="settings">Settings &amp; install</Link>.</p>
          </Card>
          <Card title="Inventory" actions={<Link to="cookies">Manage</Link>}>
            <div className="stack" style={{ gap: 8 }}>
              {(['necessary', 'preferences', 'statistics', 'marketing', 'unclassified'] as const).map((c) => {
                const n = byCategory.find((b) => b.category === c)?.count ?? 0;
                return <div key={c} className="row" style={{ justifyContent: 'space-between' }}><CatPill cat={c} /><span className="mono">{n}</span></div>;
              })}
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              Last scan: {lastScan ? <><StatusPill status={lastScan.status} /> {fmtDate(lastScan.finished_at ?? lastScan.started_at)}</> : 'never'} · Banner version {banner?.version ?? '—'}
            </p>
          </Card>
        </div>
      </div>

      <Card
        title="Consent activity"
        actions={
          <div className="seg" role="group" aria-label="Period">
            {[7, 30, 90].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>)}
          </div>
        }
      >
        {!s ? <Loading /> : (
          <>
            <div className="kpis">
              <div className="kpi"><b>{s.totals.impressions.toLocaleString()}</b><span>Banner impressions</span></div>
              <div className="kpi"><b>{decided.toLocaleString()}</b><span>Decisions · {fmtPct(s.rates.interaction)} interaction rate</span></div>
              <div className="kpi"><b>{fmtPct(s.rates.acceptAll)}</b><span>Accept all</span></div>
              <div className="kpi"><b>{fmtPct(s.rates.rejectAll)}</b><span>Reject all · {fmtPct(s.rates.custom)} custom</span></div>
            </div>
            <DailyChart daily={s.daily} />
            <div className="grid2" style={{ marginTop: 16 }}>
              <div>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Opt-in by category</h3>
                {(['preferences', 'statistics', 'marketing'] as const).map((c) => {
                  const v = s.categories.total ? s.categories[c] / s.categories.total : 0;
                  return (
                    <div key={c} style={{ marginBottom: 10 }}>
                      <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}><span>{CATEGORY_LABEL[c]}</span><span className="mono">{fmtPct(s.categories.total ? v : null)}</span></div>
                      <div className="bar"><i className={`cat-${c}`} style={{ width: `${v * 100}%` }} /></div>
                    </div>
                  );
                })}
              </div>
              <div>
                <h3 style={{ fontSize: 14, marginBottom: 6 }}>Top countries</h3>
                {s.countries.length ? (
                  <table className="tbl">
                    <thead><tr><th>Country</th><th className="num">Decisions</th><th className="num">Accept all</th><th className="num">Reject all</th></tr></thead>
                    <tbody>{s.countries.map((c) => <tr key={c.country}><td>{c.country}</td><td className="num">{c.total}</td><td className="num">{c.accept_all}</td><td className="num">{c.reject_all}</td></tr>)}</tbody>
                  </table>
                ) : <p className="muted">No decisions recorded in this period.</p>}
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
