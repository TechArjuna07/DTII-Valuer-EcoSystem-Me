import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { refreshSession, tokenStore } from '@/services/apiClient';
import * as authApi from '@/services/authApi';

/**
 * Session state for the SPA. The UI hides what a user cannot do, but EVERY permission is enforced again by the
 * API — the frontend checks here are for usability only.
 */
const AuthContext = createContext(null);

/** Landing page per context. Role dashboards are added as their modules are built. */
export function homeFor(me) {
  if (!me) return '/login';
  if (me.context.type === 'PLATFORM') return '/platform';
  const perms = me.context.permissions;
  if (perms.includes('employee.manage')) return '/dashboard';
  if (perms.includes('inspection.perform')) return '/inspections';
  if (perms.includes('portal.access')) return '/portal';
  if (perms.includes('case.view') || perms.includes('portal.access')) return '/cases';
  return '/account';
}

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  const qc = useQueryClient();
  const navigate = useNavigate();

  const loadMe = useCallback(async () => {
    const data = await authApi.getMe();
    setMe(data);
    setStatus('authenticated');
    return data;
  }, []);

  useEffect(() => {
    tokenStore.onExpired(() => {
      setMe(null);
      setStatus('anonymous');
      qc.clear();
      navigate('/login?expired=1', { replace: true });
    });
    (async () => {
      // Restore the session from the HttpOnly refresh cookie on first load.
      if (await refreshSession()) {
        try {
          await loadMe();
          return;
        } catch {
          /* fall through */
        }
      }
      setStatus('anonymous');
    })();
  }, [loadMe, qc, navigate]);

  const value = useMemo(() => {
    const permissions = me?.context.permissions ?? [];
    return {
      status,
      me,
      permissions,
      /** true when the user has ALL listed permissions */
      can: (...codes) => codes.every((c) => permissions.includes(c)),
      /** true when the user has ANY listed permission */
      canAny: (...codes) => codes.some((c) => permissions.includes(c)),
      isPlatform: me?.context.type === 'PLATFORM',
      async login(email, password) {
        await authApi.login(email, password);
        qc.clear();
        return loadMe();
      },
      async logout() {
        await authApi.logout();
        setMe(null);
        setStatus('anonymous');
        qc.clear();
        navigate('/login', { replace: true });
      },
      async switchContext(firmId) {
        await authApi.switchContext(firmId);
        qc.clear();
        const data = await loadMe();
        navigate(homeFor(data), { replace: true });
      },
      reload: loadMe,
    };
  }, [status, me, qc, loadMe, navigate]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
