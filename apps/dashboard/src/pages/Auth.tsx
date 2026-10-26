import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Button, ErrorNote, Field } from '../components/ui';

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

export function LoginPage() {
  const { me, signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    const r = await api<{ token: string }>('/api/auth/login', { method: 'POST', body: { email, password } });
    await signIn(r.token);
    nav('/');
  });
  if (me) return <Navigate to="/" replace />;
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Sign in to ConsentFlow</h1>
        <ErrorNote error={error} />
        <Field label="Work email" htmlFor="email"><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="password"><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button variant="primary" busy={busy} type="submit">Sign in</Button>
        <p className="muted">No account yet? <Link to="/register">Create one</Link></p>
      </form>
    </div>
  );
}

export function RegisterPage() {
  const { me, signIn } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '', orgName: '' });
  const { busy, error, submit } = useSubmit(async () => {
    const r = await api<{ token: string }>('/api/auth/register', { method: 'POST', body: { ...f, orgName: f.orgName || undefined } });
    await signIn(r.token);
    nav('/');
  });
  if (me) return <Navigate to="/" replace />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Create your account</h1>
        <ErrorNote error={error} />
        <Field label="Your name" htmlFor="name"><input id="name" required value={f.name} onChange={set('name')} autoComplete="name" /></Field>
        <Field label="Work email" htmlFor="email"><input id="email" type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters."><input id="password" type="password" minLength={8} required value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
        <Field label="Company or workspace name" htmlFor="org"><input id="org" value={f.orgName} onChange={set('orgName')} placeholder="Acme Inc." /></Field>
        <Button variant="primary" busy={busy} type="submit">Create account</Button>
        <p className="muted">Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}

export function InvitePage() {
  const { token } = useParams();
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    const r = await api<{ token: string }>('/api/auth/accept-invite', { method: 'POST', body: { token, name: name || undefined, password } });
    await signIn(r.token);
    nav('/');
  });
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Join your team on ConsentFlow</h1>
        <p className="muted">New here? Enter your name and choose a password. Already have an account with this email? Enter its password.</p>
        <ErrorNote error={error} />
        <Field label="Your name (new accounts)" htmlFor="name"><input id="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Password" htmlFor="password"><input id="password" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button variant="primary" busy={busy} type="submit">Accept invitation</Button>
      </form>
    </div>
  );
}
