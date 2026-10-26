import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, hashPassword, requireAuth, verifyPassword } from '../auth';
import { one, q, tx } from '../db';
import { badRequest, conflict, HttpError } from '../errors';

const Register = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  orgName: z.string().trim().min(1).max(100).optional(),
});
const Login = z.object({ email: z.string().trim().email(), password: z.string().min(1) });
const AcceptInvite = z.object({ token: z.string().min(10), name: z.string().trim().min(1).max(100).optional(), password: z.string().min(8).max(200).optional() });

export async function authRoutes(app: FastifyInstance) {
  const sign = (u: { id: string; email: string }) => app.jwt.sign({ sub: u.id, email: u.email }, { expiresIn: '7d' });

  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = Register.parse(req.body);
    const existing = await one('SELECT 1 FROM users WHERE email=$1', [body.email]);
    if (existing) throw conflict('An account with this email already exists. Sign in instead.');
    const hash = await hashPassword(body.password);
    const { user, org } = await tx(async (c) => {
      const user = (await c.query<{ id: string; email: string; name: string }>('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id, email, name', [body.email, body.name, hash])).rows[0];
      const org = (await c.query<{ id: string; name: string }>('INSERT INTO organizations (name) VALUES ($1) RETURNING id, name', [body.orgName || `${body.name}'s workspace`])).rows[0];
      await c.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,'owner')`, [org.id, user.id]);
      return { user, org };
    });
    await audit(org.id, user.id, 'org.created', { name: org.name });
    return { token: sign(user), user, orgs: [{ ...org, role: 'owner' }] };
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const body = Login.parse(req.body);
    const user = await one<{ id: string; email: string; name: string; password_hash: string }>('SELECT * FROM users WHERE email=$1', [body.email]);
    if (!user || !(await verifyPassword(body.password, user.password_hash))) throw new HttpError(401, 'Email or password is incorrect', 'invalid_credentials');
    await q('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
    return { token: sign(user), user: { id: user.id, email: user.email, name: user.name } };
  });

  app.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const user = await one<{ id: string; email: string; name: string }>('SELECT id, email, name FROM users WHERE id=$1', [req.user.id]);
    if (!user) throw new HttpError(401, 'Sign in to continue', 'unauthorized');
    const orgs = await q(
      `SELECT o.id, o.name, o.plan, m.role FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id=$1 ORDER BY o.created_at`,
      [req.user.id],
    );
    return { user, orgs };
  });

  /** Accept an invitation. Works for new users (name + password) and for signed-in existing users. */
  app.post('/api/auth/accept-invite', async (req) => {
    const body = AcceptInvite.parse(req.body);
    const inv = await one<{ id: string; org_id: string; email: string; role: string; expires_at: string; accepted_at: string | null }>(
      'SELECT * FROM invitations WHERE token=$1',
      [body.token],
    );
    if (!inv || inv.accepted_at || new Date(inv.expires_at) < new Date()) throw badRequest('This invitation is invalid or has expired. Ask for a new one.');
    let user = await one<{ id: string; email: string; name: string }>('SELECT id, email, name FROM users WHERE email=$1', [inv.email]);
    if (!user) {
      if (!body.name || !body.password) throw badRequest('Enter your name and a password (at least 8 characters) to create your account.');
      user = (await q<{ id: string; email: string; name: string }>('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id, email, name', [inv.email, body.name, await hashPassword(body.password)]))[0];
    } else if (body.password) {
      const full = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [user.id]);
      if (!full || !(await verifyPassword(body.password, full.password_hash))) throw new HttpError(401, 'Password is incorrect', 'invalid_credentials');
    } else {
      throw badRequest('An account with this email exists. Enter its password to accept.');
    }
    await tx(async (c) => {
      await c.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (org_id, user_id) DO UPDATE SET role=EXCLUDED.role`, [inv.org_id, user!.id, inv.role]);
      await c.query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [inv.id]);
    });
    await audit(inv.org_id, user.id, 'member.joined', { email: user.email, role: inv.role });
    return { token: sign(user), user };
  });
}
