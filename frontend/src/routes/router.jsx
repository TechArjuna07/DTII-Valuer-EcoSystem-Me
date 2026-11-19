import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import AuthLayout from '@/layouts/AuthLayout';
import { Spinner } from '@/components/ui/primitives';

const SystemStatusPage = lazy(() => import('@/pages/system/SystemStatusPage'));
const NotFoundPage = lazy(() => import('@/pages/system/NotFoundPage'));

const page = (Component) => (
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

/**
 * Application routes. Role-specific areas (superadmin, admin, marketing, field officer, reviewers, client)
 * are added module by module, each guarded on the client AND authorised by the API.
 */
export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/status" replace /> },
  {
    element: <AuthLayout />,
    children: [{ path: '/status', element: page(SystemStatusPage) }],
  },
  { path: '*', element: page(NotFoundPage) },
]);
