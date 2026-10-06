/**
 * Session courante : utilisateur connecté, cabinet, permissions.
 * Les permissions sont appliquées côté serveur ; côté client elles servent
 * uniquement à afficher ou masquer les actions.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [clinic, setClinic] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/auth/me');
      setUser(data.user);
      setClinic(data.clinic);
    } catch {
      setUser(null);
      setClinic(null);
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/api/auth/login', { email, password });
    setUser(data.user);
    setClinic(data.clinic);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } finally { setUser(null); setClinic(null); }
  }, []);

  const has = useCallback(
    (permission) => {
      if (!user) return false;
      const list = user.permissions || [];
      if (list.includes('*')) return true;
      if (list.includes(permission)) return true;
      if (permission.endsWith('.write') && list.includes(`${permission}:self`)) return true;
      return false;
    },
    [user]
  );

  const value = useMemo(() => ({ user, clinic, loading, login, logout, has, refresh: load }), [
    user, clinic, loading, login, logout, has, load,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession doit être utilisé dans SessionProvider');
  return ctx;
}
