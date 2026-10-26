import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, type Me, type Org } from './api';

interface AuthState {
  me: Me | null;
  loading: boolean;
  org: Org | null;
  setOrgId(id: string): void;
  signIn(token: string): Promise<void>;
  signOut(): void;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const ORG_KEY = 'consentflow.org';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ORG_KEY);
    } catch {
      return null;
    }
  });

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('/api/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onOut = () => setMe(null);
    window.addEventListener('consentflow:signed-out', onOut);
    return () => window.removeEventListener('consentflow:signed-out', onOut);
  }, [refresh]);

  const value = useMemo<AuthState>(() => {
    const org = me?.orgs.find((o) => o.id === orgId) ?? me?.orgs[0] ?? null;
    return {
      me,
      loading,
      org,
      setOrgId(id) {
        setOrgIdState(id);
        try {
          localStorage.setItem(ORG_KEY, id);
        } catch {
          /* ignore */
        }
      },
      async signIn(token) {
        setToken(token);
        setLoading(true);
        await refresh();
      },
      signOut() {
        setToken(null);
        setMe(null);
      },
      refresh,
    };
  }, [me, loading, orgId, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

const RANK = { viewer: 0, editor: 1, admin: 2, owner: 3 } as const;
export function can(role: keyof typeof RANK | undefined | null, min: keyof typeof RANK): boolean {
  return !!role && RANK[role] >= RANK[min];
}
