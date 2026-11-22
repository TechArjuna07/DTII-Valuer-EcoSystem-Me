/**
 * RBAC catalogue: single source of truth for roles, permissions and the platform-default role → permission
 * mapping (see docs/PHASE_1_ARCHITECTURE_AND_PLAN.md §4). Seeded into roles / permissions / role_permissions.
 *
 * Permissions grant the ability to call an operation; DATA SCOPE (own firm, assigned cases, own client record)
 * is enforced separately by the access policy. "critical" permissions protect workflow integrity and cannot be
 * toggled by a firm admin.
 */

const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  FIRM_ADMIN: 'FIRM_ADMIN',
  MARKETING: 'MARKETING',
  FIELD_OFFICER: 'FIELD_OFFICER',
  JUNIOR_REVIEWER: 'JUNIOR_REVIEWER',
  SENIOR_REVIEWER: 'SENIOR_REVIEWER',
  CLIENT: 'CLIENT',
});

const ROLE_DEFINITIONS = [
  { code: ROLES.SUPER_ADMIN, name: 'Superadmin', scope: 'PLATFORM', sortOrder: 0, description: 'Platform administrator: registers and manages valuation firms.' },
  { code: ROLES.FIRM_ADMIN, name: 'Firm Admin', scope: 'FIRM', sortOrder: 1, description: 'Manages the firm, its employees, clients, masters and all cases.' },
  { code: ROLES.MARKETING, name: 'Marketing Employee', scope: 'FIRM', sortOrder: 2, description: 'Registers cases, assigns field officers, handles bank submission and loan tracking.' },
  { code: ROLES.FIELD_OFFICER, name: 'Field Officer', scope: 'FIRM', sortOrder: 3, description: 'Performs property inspections on assigned cases.' },
  { code: ROLES.JUNIOR_REVIEWER, name: 'Junior Technical Reviewer', scope: 'FIRM', sortOrder: 4, description: 'Prepares preliminary valuation reports.' },
  { code: ROLES.SENIOR_REVIEWER, name: 'Senior Technical Reviewer', scope: 'FIRM', sortOrder: 5, description: 'Verifies valuations and issues final bank-specific reports.' },
  { code: ROLES.CLIENT, name: 'Client', scope: 'FIRM', sortOrder: 6, description: 'Loan applicant / property owner using the client portal.' },
];

const { SUPER_ADMIN: SA, FIRM_ADMIN: FA, MARKETING: MK, FIELD_OFFICER: FO, JUNIOR_REVIEWER: JR, SENIOR_REVIEWER: SR, CLIENT: CL } = ROLES;
const STAFF = [FA, MK, FO, JR, SR];

/** [code, module, description, roles, critical?] */
const PERMISSION_DEFINITIONS = [
  // Platform
  ['platform.dashboard.view', 'platform', 'View platform-wide statistics', [SA], true],
  ['platform.firms.manage', 'platform', 'Register, edit, suspend and deactivate valuation firms', [SA], true],
  ['platform.audit.view', 'platform', 'View the platform audit log', [SA], true],

  // Firm administration
  ['firm.settings.manage', 'firm', 'Manage firm profile, branding and preferences', [FA], true],
  ['firm.smtp.manage', 'firm', 'Configure firm SMTP / mail settings', [FA], true],
  ['employee.manage', 'employees', 'Register, edit, deactivate and unlock employees', [FA], true],
  ['rbac.manage', 'employees', 'Grant or revoke non-critical permissions per role', [FA], true],
  ['audit.view', 'audit', 'View the firm audit log', [FA], true],

  // Clients & masters
  ['client.view', 'clients', 'View clients (scope limited by assignment)', [FA, MK, FO, JR, SR]],
  ['client.manage', 'clients', 'Register and edit clients', [FA, MK]],
  ['master.view', 'masters', 'View banks/NBFCs, categories, document types and other masters', [FA, MK, FO, JR, SR]],
  ['master.manage', 'masters', 'Manage banks/NBFCs, categories, document types and financial years', [FA]],
  ['template.manage', 'masters', 'Manage bank/NBFC report templates', [FA], true],
  ['workflow.config.manage', 'masters', 'Configure SLAs, auto-assignment and optional workflow steps', [FA], true],

  // Cases
  ['case.create', 'cases', 'Register new valuation cases', [FA, MK]],
  ['case.view', 'cases', 'View cases (scope limited by assignment)', STAFF],
  ['case.view.all', 'cases', 'View every case of the firm', [FA, MK]],
  ['case.assign.field', 'cases', 'Assign a field officer to a case', [FA, MK]],
  ['case.assign.reviewer', 'cases', 'Assign junior / senior technical reviewers', [FA]],
  ['case.hold', 'cases', 'Put a case on hold and resume it', [FA], true],
  ['case.cancel', 'cases', 'Cancel a case', [FA], true],
  ['case.close', 'cases', 'Close a completed case', [FA, MK]],

  // Documents
  ['document.view', 'documents', 'View case documents (folder ACL applies)', [...STAFF, CL]],
  ['document.upload', 'documents', 'Upload case documents (folder ACL applies)', [...STAFF, CL]],
  ['document.request', 'documents', 'Request missing documents or clarification', STAFF],

  // Inspection
  ['inspection.perform', 'inspections', 'Schedule and perform property inspections', [FO], true],
  ['inspection.submit', 'inspections', 'Submit the inspection report', [FO], true],

  // Valuation
  ['valuation.prepare', 'valuations', 'Prepare preliminary valuation reports', [JR], true],
  ['valuation.submit', 'valuations', 'Submit preliminary valuation for senior review', [JR], true],
  ['valuation.review', 'valuations', 'Review, return or reject preliminary valuations', [SR], true],
  ['valuation.approve', 'valuations', 'Approve valuation and issue the final report', [SR], true],
  ['signature.valuer', 'signatures', 'Digitally sign final reports as valuer', [SR], true],

  // Client portal
  ['portal.access', 'portal', 'Use the client portal', [CL], true],

  // IGR Maharashtra eASR (government ready-reckoner rates, shared platform data)
  ['asr.view', 'asr', 'Look up IGR Maharashtra eASR rates (ready reckoner)', [SA, ...STAFF]],
  ['asr.manage', 'asr', 'Refresh cached eASR data and view fetch status', [SA], true],

  // Reports
  ['reports.view', 'reports', 'View dashboards and reports (scope limited by role)', STAFF],
].map(([code, module, description, roles, critical = false]) => ({ code, module, description, roles, isCritical: critical }));

export { ROLES, ROLE_DEFINITIONS, PERMISSION_DEFINITIONS };
