import { one } from '../db';

export interface ComplianceCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

/** Plain checks a privacy reviewer would ask about first. The score is the share of checks passed. */
export async function complianceReport(domainId: string): Promise<{ score: number; checks: ComplianceCheck[] }> {
  const r = await one<{
    published: boolean;
    show_reject_all: boolean | null;
    privacy_policy_url: string | null;
    has_opt_in_rule: boolean;
    last_scan_at: string | null;
    last_scan_id: string | null;
    unclassified: number;
    pre_consent: number;
    recent_activity: number;
  }>(
    `WITH last_scan AS (
       SELECT id, finished_at FROM scans WHERE domain_id=$1 AND status='completed' ORDER BY finished_at DESC LIMIT 1
     )
     SELECT
       EXISTS (SELECT 1 FROM banner_configs WHERE domain_id=$1 AND status='published') AS published,
       (SELECT show_reject_all FROM banner_configs WHERE domain_id=$1 AND status='published') AS show_reject_all,
       d.privacy_policy_url,
       EXISTS (SELECT 1 FROM geo_rules WHERE domain_id=$1 AND enabled AND model='opt_in') AS has_opt_in_rule,
       (SELECT finished_at FROM last_scan) AS last_scan_at,
       (SELECT id FROM last_scan) AS last_scan_id,
       (SELECT count(*)::int FROM domain_cookies WHERE domain_id=$1 AND category='unclassified') AS unclassified,
       (SELECT count(*)::int FROM scan_findings f WHERE f.scan_id=(SELECT id FROM last_scan)
          AND f.set_before_consent AND f.category IN ('statistics','marketing','unclassified')
          AND f.kind IN ('cookie','pixel')) AS pre_consent,
       ((SELECT count(*) FROM banner_impressions WHERE domain_id=$1 AND day >= current_date - 7)
        + (SELECT count(*) FROM consent_records WHERE domain_id=$1 AND created_at > now() - interval '7 days'))::int AS recent_activity
     FROM domains d WHERE d.id=$1`,
    [domainId],
  );
  if (!r) return { score: 0, checks: [] };
  const scanAgeDays = r.last_scan_at ? (Date.now() - new Date(r.last_scan_at).getTime()) / 86400e3 : null;
  const checks: ComplianceCheck[] = [
    {
      id: 'installed',
      label: 'Banner script is installed',
      passed: r.recent_activity > 0,
      detail: r.recent_activity > 0 ? 'The banner was shown or used in the last 7 days.' : 'No banner activity in the last 7 days. Add the script tag to your site.',
    },
    {
      id: 'recent_scan',
      label: 'Site scanned in the last 30 days',
      passed: scanAgeDays !== null && scanAgeDays <= 30,
      detail: scanAgeDays === null ? 'No completed scan yet.' : `Last scan ${Math.floor(scanAgeDays)} days ago.`,
    },
    {
      id: 'classified',
      label: 'Every cookie has a category',
      passed: r.last_scan_id !== null && r.unclassified === 0,
      detail: r.unclassified ? `${r.unclassified} cookie(s) are unclassified and treated as marketing.` : r.last_scan_id ? 'All cookies are categorized.' : 'Run a scan first.',
    },
    {
      id: 'pre_consent',
      label: 'No tracking cookies before consent',
      passed: r.last_scan_id !== null && r.pre_consent === 0,
      detail: r.pre_consent
        ? `${r.pre_consent} statistics or marketing cookie(s) were set before the visitor chose. Block the scripts that set them.`
        : r.last_scan_id ? 'The last scan found no tracking cookies before consent.' : 'Run a scan first.',
    },
    {
      id: 'reject_all',
      label: '"Reject all" is as easy as "Accept all"',
      passed: !r.has_opt_in_rule || r.show_reject_all === true,
      detail: r.has_opt_in_rule && !r.show_reject_all ? 'EU regulators expect a reject button on the first layer of the banner.' : 'Reject all is shown on the first layer.',
    },
    {
      id: 'policy',
      label: 'Privacy policy is linked',
      passed: !!r.privacy_policy_url,
      detail: r.privacy_policy_url ? r.privacy_policy_url : 'Add your privacy policy URL in domain settings.',
    },
    {
      id: 'published',
      label: 'Banner is published',
      passed: r.published,
      detail: r.published ? 'A published banner is live.' : 'Publish a banner configuration.',
    },
  ];
  const score = Math.round((checks.filter((c) => c.passed).length / checks.length) * 100);
  return { score, checks };
}
