import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { can } from '../auth';
import { Button, Card, CopyBox, ErrorNote, Field, Modal, useToast } from '../components/ui';
import { useDomain } from './DomainLayout';

export function SettingsPage() {
  const { domain, reloadDomain, reloadDomains } = useDomain();
  const toast = useToast();
  const nav = useNavigate();
  const editable = can(domain.role, 'editor');
  const [f, setF] = useState({
    privacyPolicyUrl: domain.privacy_policy_url ?? '',
    consentExpiryDays: domain.consent_expiry_days,
    scanFrequency: domain.scan_frequency,
    scanPageLimit: domain.scan_page_limit,
    extraHostnames: domain.extra_hostnames.join(', '),
    googleConsentMode: domain.google_consent_mode,
    autoBlock: domain.auto_block,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/domains/${domain.id}`, {
        method: 'PATCH',
        body: { ...f, privacyPolicyUrl: f.privacyPolicyUrl || '', extraHostnames: f.extraHostnames.split(/[\s,]+/).filter(Boolean) },
      });
      reloadDomain();
      toast('Settings saved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    try {
      await api(`/api/domains/${domain.id}/rotate-key`, { method: 'POST' });
      reloadDomain();
      toast('New key created. Update the script tag on your site; the old URL stops working now.');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const remove = async () => {
    try {
      await api(`/api/domains/${domain.id}`, { method: 'DELETE' });
      reloadDomains();
      toast(`${domain.hostname} deleted`);
      nav('/');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <div className="grid2">
      <div className="stack">
        <Card title="Install on your site">
          <p className="muted" style={{ marginTop: 0 }}>Add the script as the first tag in <code>&lt;head&gt;</code>, before Google Tag Manager and any other tracking scripts, so it can block them.</p>
          <CopyBox label="Banner script" value={domain.install.html} />
          <CopyBox label="Cookie declaration (put on your privacy or cookie policy page)" value={domain.install.declarationHtml} />
          <CopyBox label="Link that reopens the preferences (e.g. in your footer)" value={`<a href="#" onclick="ConsentFlow.showPreferences();return false;">Cookie settings</a>`} />
          <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>Block your own tags by hand</h3>
          <p className="muted" style={{ marginTop: 0 }}>Change <code>type</code> to <code>text/plain</code> and add a category. The tag runs once the visitor allows that category.</p>
          <CopyBox value={`<script type="text/plain" data-category="statistics" src="https://example.com/analytics.js"></script>`} />
          <CopyBox value={`<iframe data-cf-src="https://www.youtube.com/embed/VIDEO_ID" data-category="marketing" width="560" height="315"></iframe>`} />
          <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>WordPress and Google Tag Manager</h3>
          <p className="muted" style={{ margin: 0 }}>
            WordPress: install the plugin from <code>integrations/wordpress</code> in the repository and paste this domain key: <code>{domain.public_key}</code>.
            Google Tag Manager: keep the script above in your page template (not inside GTM) so Consent Mode defaults are set before GTM loads. ConsentFlow pushes a <code>consentflow_update</code> event to the data layer on every change.
          </p>
        </Card>
        <Card title="Danger zone">
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Create a new public key. The current script URL stops working.</span>
              <Button disabled={!can(domain.role, 'admin')} onClick={rotate}>Rotate key</Button>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Delete this domain, its inventory and its consent log.</span>
              <Button variant="danger" disabled={!can(domain.role, 'admin')} onClick={() => setConfirmDelete(true)}>Delete domain</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Settings" actions={editable ? <Button variant="primary" busy={busy} onClick={save}>Save settings</Button> : null}>
        <ErrorNote error={error} />
        <div className="stack" style={{ gap: 14 }}>
          <Field label="Privacy policy URL" htmlFor="pp" hint="Linked from the banner and the preference center.">
            <input id="pp" type="url" value={f.privacyPolicyUrl} disabled={!editable} onChange={(e) => setF({ ...f, privacyPolicyUrl: e.target.value })} placeholder="https://example.com/privacy" />
          </Field>
          <Field label="Ask again after (days)" htmlFor="exp" hint="Many EU regulators recommend asking again after 6 to 12 months.">
            <input id="exp" type="number" min={1} max={730} value={f.consentExpiryDays} disabled={!editable} onChange={(e) => setF({ ...f, consentExpiryDays: Number(e.target.value) })} />
          </Field>
          <div className="form-grid">
            <Field label="Automatic scans" htmlFor="freq">
              <select id="freq" value={f.scanFrequency} disabled={!editable} onChange={(e) => setF({ ...f, scanFrequency: e.target.value as typeof f.scanFrequency })}>
                <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="off">Off</option>
              </select>
            </Field>
            <Field label="Pages per scan" htmlFor="limit">
              <input id="limit" type="number" min={1} max={5000} value={f.scanPageLimit} disabled={!editable} onChange={(e) => setF({ ...f, scanPageLimit: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Other hostnames for this site" htmlFor="extra" hint="Comma separated, e.g. shop.example.com. Consent posts are accepted from these hostnames and their subdomains.">
            <input id="extra" value={f.extraHostnames} disabled={!editable} onChange={(e) => setF({ ...f, extraHostnames: e.target.value })} />
          </Field>
          <label className="check"><input type="checkbox" checked={f.googleConsentMode} disabled={!editable} onChange={(e) => setF({ ...f, googleConsentMode: e.target.checked })} /><span>Send Google Consent Mode v2 signals<br /><small className="hint">Sets ad_storage, analytics_storage, ad_user_data and ad_personalization for Google tags.</small></span></label>
          <label className="check"><input type="checkbox" checked={f.autoBlock} disabled={!editable} onChange={(e) => setF({ ...f, autoBlock: e.target.checked })} /><span>Block known trackers automatically<br /><small className="hint">Turn off if you prefer to mark every tag by hand.</small></span></label>
        </div>
      </Card>

      {confirmDelete ? (
        <Modal title={`Delete ${domain.hostname}?`} onClose={() => setConfirmDelete(false)}
          footer={<><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" disabled={confirmText !== domain.hostname} onClick={remove}>Delete forever</Button></>}>
          <p style={{ margin: 0 }}>This deletes the consent log too, which you may need as proof of consent. Export it first. This cannot be undone.</p>
          <Field label={`Type ${domain.hostname} to confirm`} htmlFor="confirm"><input id="confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
        </Modal>
      ) : null}
    </div>
  );
}
