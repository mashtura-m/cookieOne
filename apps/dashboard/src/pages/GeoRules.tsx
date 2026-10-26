import { useEffect, useState } from 'react';
import { DEFAULT_GEO_RULES, resolveRule } from '@consentflow/shared';
import { api, type GeoRuleRow } from '../api';
import { can } from '../auth';
import { useResource } from '../hooks';
import { Button, Card, ErrorNote, Field, Loading, useToast } from '../components/ui';
import { useDomain } from './DomainLayout';

const REG_LABEL = { gdpr: 'GDPR', ccpa: 'CCPA / US states', lgpd: 'LGPD', none: 'None' } as const;
const MODEL_LABEL = { opt_in: 'Opt-in: block until the visitor accepts', opt_out: 'Opt-out: allow, offer “Do Not Sell”', notice: 'Notice only: inform, allow' } as const;

export function GeoRulesPage() {
  const { domain } = useDomain();
  const toast = useToast();
  const editable = can(domain.role, 'editor');
  const res = useResource<GeoRuleRow[]>(`/api/domains/${domain.id}/geo-rules`);
  const [rules, setRules] = useState<(GeoRuleRow & { regionsText: string })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState({ country: 'DE', region: '' });

  useEffect(() => {
    if (res.data) setRules(res.data.map((r) => ({ ...r, regionsText: r.regions.join(', ') })));
  }, [res.data]);

  if (res.error) return <ErrorNote error={res.error} />;
  if (!rules) return <Loading />;

  const update = (i: number, patch: Partial<GeoRuleRow & { regionsText: string }>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const parsed = rules.map((r) => ({ ...r, regions: r.regionsText.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) }));
  const result = resolveRule(parsed, test.country || null, test.region || null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = parsed.map(({ regionsText: _r, id: _id, ...r }) => r);
      const saved = await api<GeoRuleRow[]>(`/api/domains/${domain.id}/geo-rules`, { method: 'PUT', body });
      setRules(saved.map((r) => ({ ...r, regionsText: r.regions.join(', ') })));
      toast('Geo rules saved. The banner picks them up within a minute.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Card
        title="Which rules apply where"
        actions={editable ? (
          <>
            <Button onClick={() => setRules(DEFAULT_GEO_RULES.map((r) => ({ ...r, regionsText: r.regions.join(', ') })))}>Reset to defaults</Button>
            <Button onClick={() => setRules([...rules, { name: 'New rule', regulation: 'none', model: 'notice', regions: [], regionsText: '', honorGpc: true, priority: 5, enabled: true }])}>Add rule</Button>
            <Button variant="primary" busy={busy} onClick={save}>Save rules</Button>
          </>
        ) : null}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          The visitor's location comes from your CDN's geo headers. A state code like <code>US-CA</code> beats a country code, a country code beats <code>*</code>,
          and the higher priority wins among equals. When nothing matches, the strictest rule (opt-in) applies.
        </p>
        <ErrorNote error={error} />
        <div className="stack">
          {rules.map((r, i) => (
            <div key={i} className="card" style={{ background: 'var(--sunk)', opacity: r.enabled ? 1 : 0.6 }}>
              <div className="form-grid">
                <Field label="Name" htmlFor={`n${i}`}><input id={`n${i}`} value={r.name} disabled={!editable} onChange={(e) => update(i, { name: e.target.value })} /></Field>
                <Field label="Regulation" htmlFor={`r${i}`}>
                  <select id={`r${i}`} value={r.regulation} disabled={!editable} onChange={(e) => update(i, { regulation: e.target.value as GeoRuleRow['regulation'] })}>
                    {Object.entries(REG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Consent model" htmlFor={`m${i}`}>
                  <select id={`m${i}`} value={r.model} disabled={!editable} onChange={(e) => update(i, { model: e.target.value as GeoRuleRow['model'] })}>
                    {Object.entries(MODEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Priority" htmlFor={`p${i}`}><input id={`p${i}`} type="number" min={0} max={1000} value={r.priority} disabled={!editable} onChange={(e) => update(i, { priority: Number(e.target.value) })} /></Field>
              </div>
              <div style={{ marginTop: 12 }}>
                <Field label="Regions" htmlFor={`g${i}`} hint="ISO codes separated by commas: DE, FR, US-CA, or * for everywhere else.">
                  <textarea id={`g${i}`} rows={2} className="mono" value={r.regionsText} disabled={!editable} onChange={(e) => update(i, { regionsText: e.target.value })} />
                </Field>
              </div>
              <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                <div className="row">
                  <label className="check"><input type="checkbox" checked={r.honorGpc} disabled={!editable} onChange={(e) => update(i, { honorGpc: e.target.checked })} /> Honor Global Privacy Control</label>
                  <label className="check"><input type="checkbox" checked={r.enabled} disabled={!editable} onChange={(e) => update(i, { enabled: e.target.checked })} /> Enabled</label>
                </div>
                {editable ? <Button size="sm" variant="ghost" className="btn-danger" onClick={() => setRules(rules.filter((_, j) => j !== i))}>Remove</Button> : null}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Test a location">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Country" htmlFor="tc"><input id="tc" value={test.country} maxLength={2} style={{ width: 90 }} onChange={(e) => setTest({ ...test, country: e.target.value.toUpperCase() })} /></Field>
          <Field label="State or region" htmlFor="tr"><input id="tr" value={test.region} maxLength={3} style={{ width: 90 }} placeholder="CA" onChange={(e) => setTest({ ...test, region: e.target.value.toUpperCase() })} /></Field>
          <div style={{ paddingBottom: 8 }}>
            → <b>{result.ruleName}</b>: {REG_LABEL[result.regulation]}, {MODEL_LABEL[result.model].split(':')[0].toLowerCase()}{result.honorGpc ? ', GPC honored' : ''}
          </div>
        </div>
        <p className="hint">This uses the rules as edited above, including unsaved changes.</p>
      </Card>
    </div>
  );
}
