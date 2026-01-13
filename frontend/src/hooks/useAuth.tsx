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
    const token = localStorage.getItem('token');
    if (token) {
      auth.me()
        .then((data) => {
          setUser(data.user);
          setBooting(true); // Show boot sequence for returning users
        })
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
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
