import { Archive, Building2, ClipboardCheck, FileCode2, CalendarRange, FileType2, FolderKanban, Layers, Landmark, LayoutDashboard, Route, ScrollText, Settings, ShieldCheck, UserRound, Users } from 'lucide-react';

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
      { href: '/portal', label: 'My Dashboard', icon: LayoutDashboard, context: 'FIRM', any: ['portal.access'] },
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
    section: 'Work',
    items: [
      { href: '/inspections', label: 'My Inspections', icon: ClipboardCheck, context: 'FIRM', any: ['inspection.perform'] },
      { href: '/cases', label: 'Cases', icon: FolderKanban, context: 'FIRM', any: ['case.view', 'portal.access'] },
      { href: '/repository', label: 'Document Repository', icon: Archive, context: 'FIRM', any: ['client.view', 'portal.access'] },
    ],
  },
  {
    section: 'Masters',
    items: [
      { href: '/clients', label: 'Clients', icon: Building2, context: 'FIRM', any: ['client.manage'] },
      { href: '/employees', label: 'Employees', icon: Users, context: 'FIRM', any: ['employee.manage'] },
      { href: '/masters/banks', label: 'Banks & NBFCs', icon: Landmark, context: 'FIRM', any: ['master.manage'] },
      { href: '/masters/categories', label: 'Valuation Categories', icon: Layers, context: 'FIRM', any: ['master.manage'] },
      { href: '/masters/document-types', label: 'Document Types', icon: FileType2, context: 'FIRM', any: ['master.manage'] },
      { href: '/masters/report-templates', label: 'Report Templates', icon: FileCode2, context: 'FIRM', any: ['template.manage'] },
      { href: '/masters/financial-years', label: 'Financial Years', icon: CalendarRange, context: 'FIRM', any: ['master.manage'] },
    ],
  },
  {
    section: 'Administration',
    items: [
      { href: '/masters/workflow', label: 'Workflow Settings', icon: Route, context: 'FIRM', any: ['workflow.config.manage'] },
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

