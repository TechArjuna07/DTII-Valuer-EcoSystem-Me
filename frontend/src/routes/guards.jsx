import { Navigate, Outlet, useLocation } from 'react-router';
import { homeFor, useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/ui/primitives';

const FullPageSpinner = () => (
  <div className="flex min-h-screen items-center justify-center">
    <Spinner className="size-7" />
  </div>
);

/**
 * Client-side route guard (usability only — the API authorises every request).
 * @param {{ context?: 'PLATFORM'|'FIRM', permissions?: string[], any?: boolean }} props
 */
export function RequireAuth({ context, permissions = [], any = false }) {
  const { status, me, can, canAny } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (context && me.context.type !== context) return <Navigate to={homeFor(me)} replace />;
  if (permissions.length && !(any ? canAny(...permissions) : can(...permissions))) return <Navigate to={homeFor(me)} replace />;
  return <Outlet />;
}

/** Public-only pages (login, password links): signed-in users go to their home. */
export function RedirectIfAuthenticated() {
  const { status, me } = useAuth();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') return <Navigate to={homeFor(me)} replace />;
  return <Outlet />;
}

export function HomeRedirect() {
  const { status, me } = useAuth();
  if (status === 'loading') return <FullPageSpinner />;
  return <Navigate to={status === 'authenticated' ? homeFor(me) : '/login'} replace />;
}
