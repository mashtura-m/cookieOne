import type { GeoRule, Regulation, ConsentModel } from './types';

/** EU member states + EEA + UK + Switzerland: GDPR / UK GDPR / revFADP opt-in regime. */
export const GDPR_REGIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', // EU 27
  'IS', 'LI', 'NO', // EEA
  'GB', 'CH',
];

/** US states with comprehensive privacy laws that grant an opt-out of sale/sharing and honor GPC. */
export const US_OPT_OUT_STATES = [
  'US-CA', 'US-CO', 'US-CT', 'US-VA', 'US-UT', 'US-TX', 'US-OR', 'US-MT', 'US-DE', 'US-IA',
  'US-NE', 'US-NH', 'US-NJ', 'US-TN', 'US-MN', 'US-MD', 'US-IN', 'US-KY', 'US-RI',
];

export const DEFAULT_GEO_RULES: GeoRule[] = [
  { name: 'GDPR (EU, EEA, UK, CH)', regulation: 'gdpr', model: 'opt_in', regions: GDPR_REGIONS, honorGpc: true, priority: 30, enabled: true },
  { name: 'LGPD (Brazil)', regulation: 'lgpd', model: 'opt_in', regions: ['BR'], honorGpc: true, priority: 20, enabled: true },
  { name: 'CCPA/CPRA and US state laws', regulation: 'ccpa', model: 'opt_out', regions: US_OPT_OUT_STATES, honorGpc: true, priority: 10, enabled: true },
  { name: 'Rest of world', regulation: 'none', model: 'notice', regions: ['*'], honorGpc: true, priority: 0, enabled: true },
];

export interface ResolvedRule {
  regulation: Regulation;
  model: ConsentModel;
  honorGpc: boolean;
  ruleName: string;
}

/** Strictest fallback when no rule matches (also used when the country is unknown and no '*' rule exists). */
const STRICT: ResolvedRule = { regulation: 'gdpr', model: 'opt_in', honorGpc: true, ruleName: 'Fallback (strict)' };

/**
 * Pick the rule for a visitor. Matching order: subdivision ('US-CA') beats country ('US') beats '*';
 * within the same specificity, higher priority wins.
 */
export function resolveRule(rules: GeoRule[], country: string | null, region: string | null): ResolvedRule {
  const c = country?.toUpperCase() ?? null;
  const sub = c && region ? `${c}-${region.toUpperCase()}` : null;
  let best: { rule: GeoRule; score: number } | null = null;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    let specificity = -1;
    for (const r of rule.regions.map((x) => x.toUpperCase())) {
      if (sub && r === sub) specificity = Math.max(specificity, 2);
      else if (c && r === c) specificity = Math.max(specificity, 1);
      else if (r === '*') specificity = Math.max(specificity, 0);
    }
    if (specificity < 0) continue;
    const score = specificity * 10000 + rule.priority;
    if (!best || score > best.score) best = { rule, score };
  }
  if (!best) return STRICT;
  return { regulation: best.rule.regulation, model: best.rule.model, honorGpc: best.rule.honorGpc, ruleName: best.rule.name };
}
