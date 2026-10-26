export * from './types';
export * from './texts';
export * from './regions';
export * from './categorize';

import type { ConsentChoices } from './types';

/** Google Consent Mode v2 signal mapping. */
export function toGoogleConsent(c: ConsentChoices) {
  const g = (v: boolean) => (v ? 'granted' : 'denied');
  return {
    ad_storage: g(c.marketing),
    ad_user_data: g(c.marketing),
    ad_personalization: g(c.marketing),
    analytics_storage: g(c.statistics),
    functionality_storage: g(c.preferences),
    personalization_storage: g(c.preferences),
    security_storage: 'granted',
  } as const;
}

/** Zero the last IPv4 octet or keep only the first 48 bits of an IPv6 address. */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.0');
  if (ip.includes(':')) {
    const head = ip.split('::')[0].split(':').filter(Boolean);
    while (head.length < 3) head.push('0');
    return head.slice(0, 3).join(':') + '::';
  }
  return null;
}
