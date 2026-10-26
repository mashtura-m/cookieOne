import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireAuth, requireOrg } from '../auth';
import { one, q } from '../db';
import { badRequest, forbidden, notFound } from '../errors';
import { config } from '../config';

const Role = z.enum(['owner', 'admin', 'editor', 'viewer']);

export async function orgRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.patch<{ Params: { orgId: string } }>('/api/orgs/:orgId', async (req) => {
    await requireOrg(req, req.params.orgId, 'admin');
    const body = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    const org = await one('UPDATE organizations SET name=$2 WHERE id=$1 RETURNING id, name, plan', [req.params.orgId, body.name]);
    await audit(req.params.orgId, req.user.id, 'org.renamed', body);
    return org;
  });

  app.get<{ Params: { orgId: string } }>('/api/orgs/:orgId/members', async (req) => {
    await requireOrg(req, req.params.orgId);
    const members = await q(
      `SELECT u.id, u.name, u.email, m.role, m.created_at, u.last_login_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 ORDER BY m.created_at`,
      [req.params.orgId],
    );
    const invitations = await q(
      `SELECT id, email, role, expires_at, created_at FROM invitations WHERE org_id=$1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
      [req.params.orgId],
    );
    return { members, invitations };
  });

  app.post<{ Params: { orgId: string } }>('/api/orgs/:orgId/invitations', async (req) => {
    const myRole = await requireOrg(req, req.params.orgId, 'admin');
    const body = z.object({ email: z.string().trim().email(), role: Role.default('editor') }).parse(req.body);
    if (body.role === 'owner' && myRole !== 'owner') throw forbidden('Only owners can invite owners');
    const member = await one(`SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND u.email=$2`, [req.params.orgId, body.email]);
    if (member) throw badRequest(`${body.email} is already a member`);
    const token = randomBytes(24).toString('base64url');
    const inv = await one(
      `INSERT INTO invitations (org_id, email, role, token, invited_by, expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval '7 days')
       RETURNING id, email, role, expires_at`,
      [req.params.orgId, body.email, body.role, token, req.user.id],
    );
    await audit(req.params.orgId, req.user.id, 'member.invited', { email: body.email, role: body.role });
    // No email provider is wired up in the MVP: the dashboard shows this link for the admin to send.
    return { ...inv, inviteUrl: `${config.dashboardUrl}/invite/${token}` };
  });

  app.delete<{ Params: { orgId: string; id: string } }>('/api/orgs/:orgId/invitations/:id', async (req) => {
    await requireOrg(req, req.params.orgId, 'admin');
    await q('DELETE FROM invitations WHERE id=$1 AND org_id=$2', [req.params.id, req.params.orgId]);
    return { ok: true };
  });

  app.patch<{ Params: { orgId: string; userId: string } }>('/api/orgs/:orgId/members/:userId', async (req) => {
    const myRole = await requireOrg(req, req.params.orgId, 'admin');
    const { role } = z.object({ role: Role }).parse(req.body);
    const target = await one<{ role: string }>('SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2', [req.params.orgId, req.params.userId]);
    if (!target) throw notFound('Member');
    if ((role === 'owner' || target.role === 'owner') && myRole !== 'owner') throw forbidden('Only owners can change owner roles');
    if (target.role === 'owner' && role !== 'owner') {
      const owners = await one<{ n: number }>(`SELECT count(*)::int AS n FROM memberships WHERE org_id=$1 AND role='owner'`, [req.params.orgId]);
      if ((owners?.n ?? 0) <= 1) throw badRequest('A workspace needs at least one owner');
    }
    await q('UPDATE memberships SET role=$3 WHERE org_id=$1 AND user_id=$2', [req.params.orgId, req.params.userId, role]);
    await audit(req.params.orgId, req.user.id, 'member.role_changed', { userId: req.params.userId, role });
    return { ok: true };
  });

  app.delete<{ Params: { orgId: string; userId: string } }>('/api/orgs/:orgId/members/:userId', async (req) => {
    const self = req.params.userId === req.user.id;
    const myRole = await requireOrg(req, req.params.orgId, self ? 'viewer' : 'admin');
    const target = await one<{ role: string }>('SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2', [req.params.orgId, req.params.userId]);
    if (!target) throw notFound('Member');
    if (target.role === 'owner') {
      if (myRole !== 'owner') throw forbidden('Only owners can remove owners');
      const owners = await one<{ n: number }>(`SELECT count(*)::int AS n FROM memberships WHERE org_id=$1 AND role='owner'`, [req.params.orgId]);
      if ((owners?.n ?? 0) <= 1) throw badRequest('A workspace needs at least one owner');
    }
    await q('DELETE FROM memberships WHERE org_id=$1 AND user_id=$2', [req.params.orgId, req.params.userId]);
    await audit(req.params.orgId, req.user.id, 'member.removed', { userId: req.params.userId });
    return { ok: true };
  });

  app.get<{ Params: { orgId: string }; Querystring: { limit?: string } }>('/api/orgs/:orgId/audit', async (req) => {
    await requireOrg(req, req.params.orgId, 'admin');
    const limit = Math.min(200, Number(req.query.limit ?? 100) || 100);
    return q(
      `SELECT a.id, a.action, a.details, a.created_at, a.domain_id, u.name AS user_name, d.hostname
       FROM audit_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN domains d ON d.id=a.domain_id
       WHERE a.org_id=$1 ORDER BY a.created_at DESC LIMIT $2`,
      [req.params.orgId, limit],
    );
  });

  app.get<{ Querystring: { q?: string } }>('/api/library/cookies', async (req) => {
    const term = (req.query.q ?? '').trim();
    return q(
      `SELECT id, name_pattern, is_regex, vendor, provider_domain, category, purpose, retention FROM cookie_library
       WHERE $1 = '' OR name_pattern ILIKE '%' || $1 || '%' OR vendor ILIKE '%' || $1 || '%' ORDER BY vendor, name_pattern LIMIT 200`,
      [term],
    );
  });
}
