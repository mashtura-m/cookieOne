import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MemberRole } from '@consentflow/shared';
import { one, q } from './db';
import { forbidden, HttpError, notFound } from './errors';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export interface AuthUser {
  id: string;
  email: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: AuthUser;
  }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    const payload = (await req.jwtVerify()) as unknown as { sub: string; email: string };
    req.user = { id: payload.sub, email: payload.email };
  } catch {
    throw new HttpError(401, 'Sign in to continue', 'unauthorized');
  }
}

const RANK: Record<MemberRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export function atLeast(role: MemberRole, min: MemberRole): boolean {
  return RANK[role] >= RANK[min];
}

export async function orgRole(userId: string, orgId: string): Promise<MemberRole | null> {
  const row = await one<{ role: MemberRole }>('SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2', [orgId, userId]);
  return row?.role ?? null;
}

/** Throws 404 when the user is not a member (do not reveal that the org exists), 403 when the role is too low. */
export async function requireOrg(req: FastifyRequest, orgId: string, min: MemberRole = 'viewer'): Promise<MemberRole> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw notFound('Organization');
  const role = await orgRole(req.user.id, orgId);
  if (!role) throw notFound('Organization');
  if (!atLeast(role, min)) throw forbidden();
  return role;
}

export interface DomainRow {
  id: string;
  org_id: string;
  hostname: string;
  public_key: string;
  extra_hostnames: string[];
  scan_page_limit: number;
  scan_frequency: string;
  consent_expiry_days: number;
  privacy_policy_url: string | null;
  google_consent_mode: boolean;
  auto_block: boolean;
  created_at: string;
  updated_at: string;
}

export async function requireDomain(req: FastifyRequest, domainId: string, min: MemberRole = 'viewer'): Promise<DomainRow & { role: MemberRole }> {
  if (!/^[0-9a-f-]{36}$/i.test(domainId)) throw notFound('Domain');
  const rows = await q<DomainRow & { role: MemberRole }>(
    `SELECT d.*, m.role FROM domains d JOIN memberships m ON m.org_id = d.org_id AND m.user_id = $2 WHERE d.id = $1`,
    [domainId, req.user.id],
  );
  const d = rows[0];
  if (!d) throw notFound('Domain');
  if (!atLeast(d.role, min)) throw forbidden();
  return d;
}

export async function audit(orgId: string, userId: string | null, action: string, details: Record<string, unknown> = {}, domainId: string | null = null): Promise<void> {
  await q('INSERT INTO audit_log (org_id, user_id, domain_id, action, details) VALUES ($1,$2,$3,$4,$5)', [orgId, userId, domainId, action, details]);
}
