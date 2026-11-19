/** Roles a Firm Admin can assign to employees (mirrors the API's STAFF_ROLE_CODES). */
export const STAFF_ROLES = [
  { code: 'FIRM_ADMIN', name: 'Firm Admin', hint: 'Full control of the firm: employees, clients, masters, all cases' },
  { code: 'MARKETING', name: 'Marketing Employee', hint: 'Registers cases, assigns field officers, bank submission & loan tracking' },
  { code: 'FIELD_OFFICER', name: 'Field Officer', hint: 'Property inspections on assigned cases (mobile)' },
  { code: 'JUNIOR_REVIEWER', name: 'Junior Technical Reviewer', hint: 'Prepares preliminary valuation reports' },
  { code: 'SENIOR_REVIEWER', name: 'Senior Technical Reviewer', hint: 'Verifies valuations and issues final bank reports' },
];
