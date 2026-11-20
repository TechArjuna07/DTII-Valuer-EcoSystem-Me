import OverviewTab from './OverviewTab';
import ClientTab from './ClientTab';
import TimelineTab from './TimelineTab';
import DocumentsTab from './DocumentsTab';
import PropertyTab from './PropertyTab';
import InspectionTab from './InspectionTab';
import PreliminaryTab from './PreliminaryTab';
import SeniorReviewTab from './SeniorReviewTab';
import ApprovalTab from './ApprovalTab';
import { BankSubmissionTab, SanctionDisbursementTab } from './BankLoanTabs';

/**
 * Case detail tabs, in display order. `show(ctx)` decides visibility per user (ctx = { c, me, can, isClient });
 * the API independently authorises every request each tab makes.
 */
export const CASE_TABS = [
  { key: 'overview', label: 'Overview', Component: OverviewTab, show: () => true },
  { key: 'client', label: 'Client details', Component: ClientTab, show: ({ isClient }) => !isClient },
  { key: 'property', label: 'Property details', Component: PropertyTab, show: ({ isClient }) => !isClient },
  { key: 'inspection', label: 'Inspection', Component: InspectionTab, show: ({ isClient }) => !isClient },
  { key: 'preliminary', label: 'Preliminary valuation', Component: PreliminaryTab, show: ({ me }) => me.context.roles.some((r) => ['FIRM_ADMIN', 'JUNIOR_REVIEWER', 'SENIOR_REVIEWER'].includes(r.code)) },
  { key: 'senior', label: 'Senior review', Component: SeniorReviewTab, show: ({ me, c }) => me.context.roles.some((r) => ['FIRM_ADMIN', 'JUNIOR_REVIEWER', 'SENIOR_REVIEWER'].includes(r.code)) || (me.employee && ['FINAL_APPROVED', 'CLIENT_APPROVAL_PENDING', 'CLIENT_QUERY_RAISED', 'CLIENT_APPROVED', 'CLIENT_SIGNED', 'SUBMITTED_TO_BANK', 'LOAN_SANCTIONED', 'DISBURSED', 'CASE_COMPLETED'].includes(c.status)) },
  { key: 'approval', label: 'Client approval', Component: ApprovalTab, show: ({ c, isClient, me }) => isClient || me.context.roles.some((r) => ['FIRM_ADMIN', 'SENIOR_REVIEWER', 'MARKETING'].includes(r.code)) || ['FINAL_APPROVED', 'CLIENT_APPROVAL_PENDING'].includes(c.status) },
  { key: 'bank', label: 'Bank submission', Component: BankSubmissionTab, show: ({ c, isClient }) => !isClient || ['SUBMITTED_TO_BANK', 'LOAN_SANCTIONED', 'DISBURSED', 'CASE_COMPLETED'].includes(c.status) },
  { key: 'loan', label: 'Sanction & disbursement', Component: SanctionDisbursementTab, show: ({ c }) => ['SUBMITTED_TO_BANK', 'LOAN_SANCTIONED', 'DISBURSED', 'CASE_COMPLETED', 'CASE_REJECTED'].includes(c.status) },
  { key: 'documents', label: 'Documents', Component: DocumentsTab, show: ({ can }) => can('document.view') },
  { key: 'timeline', label: 'Activity timeline', Component: TimelineTab, show: () => true },
];
