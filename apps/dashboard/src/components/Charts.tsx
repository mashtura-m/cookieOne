import type { Stats } from '../api';

const SERIES = [
  { key: 'accept_all', label: 'Accept all', color: 'var(--good)' },
  { key: 'custom', label: 'Custom choice', color: 'var(--accent)' },
  { key: 'reject_all', label: 'Reject all', color: 'var(--bad)' },
  { key: 'other', label: 'Other (GPC, notice, withdraw)', color: 'var(--muted)' },
] as const;

/** Daily stacked bars of consent decisions, with banner impressions as a line. */
export function DailyChart({ daily }: { daily: Stats['daily'] }) {
  const W = 720;
  const H = 220;
  const pad = { l: 36, r: 10, t: 10, b: 24 };
  const max = Math.max(1, ...daily.map((d) => Math.max(d.impressions, d.accept_all + d.reject_all + d.custom + d.other)));
  const nice = (() => {
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    const m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  })();
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / daily.length;
  const y = (v: number) => pad.t + ih - (v / nice) * ih;
  const ticks = [0, nice / 2, nice];
  const line = daily.map((d, i) => `${i ? 'L' : 'M'}${pad.l + bw * i + bw / 2},${y(d.impressions)}`).join(' ');
  const labelEvery = Math.ceil(daily.length / 8);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Daily consent decisions and banner impressions">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t.toLocaleString()}</text>
          </g>
        ))}
        {daily.map((d, i) => {
          let acc = 0;
          return (
            <g key={d.day}>
              {SERIES.map((s) => {
                const v = d[s.key];
                if (!v) return null;
                const y0 = y(acc);
                acc += v;
                return <rect key={s.key} x={pad.l + bw * i + bw * 0.15} width={bw * 0.7} y={y(acc)} height={Math.max(0, y0 - y(acc))} fill={s.color} rx="1.5"><title>{`${d.day}: ${s.label} ${v}`}</title></rect>;
              })}
              {i % labelEvery === 0 ? <text x={pad.l + bw * i + bw / 2} y={H - 6} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{d.day.slice(5)}</text> : null}
            </g>
          );
        })}
        <path d={line} fill="none" stroke="var(--fg)" strokeWidth="1.5" strokeDasharray="4 3" />
      </svg>
      <div className="legend">
        {SERIES.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
        <span><i style={{ background: 'none', borderTop: '2px dashed var(--fg)', height: 0 }} />Banner impressions</span>
      </div>
    </div>
  );
}

export function ScoreRing({ score }: { score: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? 'var(--good)' : score >= 60 ? 'var(--warn)' : 'var(--bad)';
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`Compliance score ${score} out of 100`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--sunk)" strokeWidth="9" />
      <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="9" strokeDasharray={`${(score / 100) * c} ${c}`} strokeLinecap="round" transform="rotate(-90 44 44)" />
      <text x="44" y="50" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--fg)">{score}</text>
    </svg>
  );
}
