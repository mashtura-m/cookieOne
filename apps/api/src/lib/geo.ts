import type { FastifyRequest } from 'fastify';
import { config } from '../config';

const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-country-code', 'x-appengine-country'];
const REGION_HEADERS = ['cf-region-code', 'x-vercel-ip-country-region', 'cloudfront-viewer-country-region', 'x-region-code', 'x-appengine-region'];

function header(req: FastifyRequest, names: string[]): string | null {
  for (const n of names) {
    const v = req.headers[n];
    const s = Array.isArray(v) ? v[0] : v;
    if (s && s !== 'XX' && s !== 'T1') return s.trim();
  }
  return null;
}

/** Visitor location from CDN/edge headers, with an optional query-string override for testing. */
export function visitorGeo(req: FastifyRequest): { country: string | null; region: string | null } {
  const query = req.query as Record<string, string | undefined>;
  if (config.allowGeoOverride && query.cf_country) {
    return { country: query.cf_country.toUpperCase().slice(0, 2), region: query.cf_region?.toUpperCase().slice(0, 3) ?? null };
  }
  const country = header(req, COUNTRY_HEADERS)?.toUpperCase().slice(0, 2) ?? config.defaultCountry;
  const region = header(req, REGION_HEADERS)?.toUpperCase().slice(0, 3) ?? null;
  return { country: country ?? null, region };
}
