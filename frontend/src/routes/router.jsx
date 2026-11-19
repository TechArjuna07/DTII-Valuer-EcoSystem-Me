import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet } from 'react-router';
import { AuthProvider } from '@/context/AuthContext';
import AuthLayout from '@/layouts/AuthLayout';
import AppShell from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/primitives';
import { HomeRedirect, RedirectIfAuthenticated, RequireAuth } from './guards';

const L = (factory) => {
  const Component = lazy(factory);
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Spinner className="size-7" />
        </div>
      }
    >
      <Component />
    </Suspense>
  );
};
const LP = (factory, props) => {
  const Component = lazy(factory);
  return (
    <Suspense fallback={<Spinner className="mx-auto size-7" />}>
      <Component {...props} />
    </Suspense>
  );
};

/** Provides auth state to every route (AuthProvider needs the router's navigate). */
function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

/**
 * Routes. Client-side guards only improve UX; every API call is authorised by the backend
 * (tenant, permission and data scope).
 */
export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <HomeRedirect /> },

      // Public
      {
        element: <AuthLayout />,
        children: [
          { path: '/status', element: L(() => import('@/pages/system/SystemStatusPage')) },
          {
            element: <RedirectIfAuthenticated />,
            children: [
              { path: '/login', element: L(() => import('@/pages/auth/LoginPage')) },
              { path: '/forgot-password', element: L(() => import('@/pages/auth/ForgotPasswordPage')) },
            ],
          },
          { path: '/accept-invite', element: LP(() => import('@/pages/auth/SetPasswordPage'), { mode: 'invite' }) },
          { path: '/reset-password', element: LP(() => import('@/pages/auth/SetPasswordPage'), { mode: 'reset' }) },
        ],
      },

      // Authenticated
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/account', element: L(() => import('@/pages/account/AccountPage')) },

              // Superadmin (platform context)
              {
                element: <RequireAuth context="PLATFORM" />,
                children: [
                  { path: '/platform', element: L(() => import('@/pages/superadmin/PlatformDashboardPage')) },
                  { path: '/platform/firms', element: L(() => import('@/pages/superadmin/FirmsListPage')) },
                  { path: '/platform/firms/new', element: L(() => import('@/pages/superadmin/FirmRegisterPage')) },
                  { path: '/platform/firms/:id', element: L(() => import('@/pages/superadmin/FirmDetailPage')) },
                  { path: '/platform/audit-logs', element: L(() => import('@/pages/superadmin/PlatformAuditPage')) },
                ],
              },

              // Firm context
              {
                element: <RequireAuth context="FIRM" permissions={['employee.manage']} />,
                children: [
                  { path: '/dashboard', element: L(() => import('@/pages/admin/AdminDashboardPage')) },
                  { path: '/employees', element: L(() => import('@/pages/admin/employees/EmployeesListPage')) },
                  { path: '/employees/new', element: L(() => import('@/pages/admin/employees/EmployeeNewPage')) },
                  { path: '/employees/:id', element: L(() => import('@/pages/admin/employees/EmployeeDetailPage')) },
                ],
              },
              {
                element: <RequireAuth context="FIRM" permissions={['client.manage']} />,
                children: [
                  { path: '/clients', element: L(() => import('@/pages/clients/ClientsListPage')) },
                  { path: '/clients/new', element: L(() => import('@/pages/clients/ClientNewPage')) },
                  { path: '/clients/:id', element: L(() => import('@/pages/clients/ClientDetailPage')) },
                ],
              },
              { element: <RequireAuth context="FIRM" permissions={['rbac.manage']} />, children: [{ path: '/roles-permissions', element: L(() => import('@/pages/admin/RolesPermissionsPage')) }] },
              { element: <RequireAuth context="FIRM" permissions={['audit.view']} />, children: [{ path: '/audit-logs', element: L(() => import('@/pages/admin/FirmAuditPage')) }] },
              { element: <RequireAuth context="FIRM" permissions={['firm.settings.manage']} />, children: [{ path: '/firm-profile', element: L(() => import('@/pages/admin/FirmProfilePage')) }] },
            ],
          },
        ],
      },

      { path: '*', element: L(() => import('@/pages/system/NotFoundPage')) },
    ],
  },
]);
