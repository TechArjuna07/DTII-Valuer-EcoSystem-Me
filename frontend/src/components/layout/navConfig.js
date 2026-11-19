import { Building2, Landmark, LayoutDashboard, ScrollText, Settings, ShieldCheck, UserRound, Users } from 'lucide-react';

/**
 * Sidebar navigation. Items are shown by CONTEXT (platform / firm) and PERMISSION, so each role only sees
 * modules it can use. New modules (cases, inspections, reviews, portal…) add their entries here.
 *   context: 'PLATFORM' | 'FIRM' | undefined (both)
 *   any: show if the user has ANY of these permissions
 */
export const NAV = [
  {
    section: 'Overview',
    items: [
      { href: '/platform', label: 'Platform Dashboard', icon: LayoutDashboard, context: 'PLATFORM', any: ['platform.dashboard.view'], exact: true },
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, context: 'FIRM', any: ['employee.manage'] },
    ],
  },
  {
    section: 'Platform',
    items: [
      { href: '/platform/firms', label: 'Valuation Firms', icon: Landmark, context: 'PLATFORM', any: ['platform.firms.manage'] },
      { href: '/platform/audit-logs', label: 'Platform Audit Log', icon: ScrollText, context: 'PLATFORM', any: ['platform.audit.view'] },
    ],
  },
  {
    section: 'Masters',
    items: [
      { href: '/clients', label: 'Clients', icon: Building2, context: 'FIRM', any: ['client.manage'] },
      { href: '/employees', label: 'Employees', icon: Users, context: 'FIRM', any: ['employee.manage'] },
    ],
  },
  {
    section: 'Administration',
    items: [
      { href: '/roles-permissions', label: 'Roles & Permissions', icon: ShieldCheck, context: 'FIRM', any: ['rbac.manage'] },
      { href: '/audit-logs', label: 'Audit Trail', icon: ScrollText, context: 'FIRM', any: ['audit.view'] },
      { href: '/firm-profile', label: 'Firm Profile', icon: Settings, context: 'FIRM', any: ['firm.settings.manage'] },
    ],
  },
  {
    section: 'Account',
    items: [{ href: '/account', label: 'My Account', icon: UserRound }],
  },
];

