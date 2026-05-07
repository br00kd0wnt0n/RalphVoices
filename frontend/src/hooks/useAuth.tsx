import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth } from '@/lib/api';
import type { User } from '@/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  booting: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  completeBootSequence: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [booting, setBooting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Narrativ SSO: when this app loads inside the Narrativ shell iframe,
      // the shell appends `?narrativ_sso=<jwt>` to the src. The first time
      // we see one we exchange for a Voices JWT and store it. On subsequent
      // remounts (Voices handoff URLs change the iframe key, which remounts
      // this React app inside the iframe) we already have a localStorage
      // token — prefer it and just strip the SSO param. Replaying the same
      // jti would otherwise produce a useless 401 from /sso/exchange.
      let url: URL | null = null;
      let ssoToken: string | null = null;
      try {
        url = new URL(window.location.href);
        ssoToken = url.searchParams.get('narrativ_sso');
      } catch (err) {
        console.warn('[narrativ-sso] URL parse skipped:', err);
      }

      const stripSsoParam = () => {
        if (!url || !ssoToken) return;
        url.searchParams.delete('narrativ_sso');
        const cleanUrl = url.pathname + (url.search ? url.search : '') + url.hash;
        window.history.replaceState({}, '', cleanUrl);
      };

      const existingToken = localStorage.getItem('token');

      if (!existingToken && ssoToken) {
        try {
          const data = await auth.exchangeNarrativSso(ssoToken);
          if (cancelled) return;
          localStorage.setItem('token', data.token);
          stripSsoParam();
          setUser(data.user);
          setBooting(true);
          setLoading(false);
          return;
        } catch (err) {
          // Strip anyway so a stale token doesn't keep retrying on reloads,
          // then fall through to the (empty) localStorage path → /login.
          console.warn('[narrativ-sso] exchange failed, falling back:', err);
          stripSsoParam();
        }
      } else if (existingToken && ssoToken) {
        // Already authenticated locally — drop the redundant SSO param so
        // it doesn't leak into history or downstream router state.
        stripSsoParam();
      }

      const token = localStorage.getItem('token');
      if (token) {
        try {
          const data = await auth.me();
          if (cancelled) return;
          setUser(data.user);
          setBooting(true);
        } catch {
          if (!cancelled) localStorage.removeItem('token');
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const data = await auth.login(email, password);
    localStorage.setItem('token', data.token);
    setUser(data.user);
    setBooting(true); // Show boot sequence after login
  };

  const register = async (email: string, password: string, name?: string) => {
    const data = await auth.register(email, password, name);
    localStorage.setItem('token', data.token);
    setUser(data.user);
    setBooting(true); // Show boot sequence after register
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setBooting(false);
  };

  const completeBootSequence = () => {
    setBooting(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, booting, login, register, logout, completeBootSequence }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
