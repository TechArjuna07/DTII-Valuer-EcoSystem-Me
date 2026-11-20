import OverviewTab from './OverviewTab';
import ClientTab from './ClientTab';
import PropertyTab from './PropertyTab';
import InspectionTab from './InspectionTab';
import DocumentsTab from './DocumentsTab';
import PreliminaryTab from './PreliminaryTab';
import SeniorReviewTab from './SeniorReviewTab';
import ApprovalTab from './ApprovalTab';
import { BankSubmissionTab, SanctionDisbursementTab } from './BankLoanTabs';
import TimelineTab from './TimelineTab';

/**
 * Case detail tabs, in the order of the case lifecycle. `show(ctx)` decides visibility per user
 * (ctx = { c, me, can, isClient }); the API independently authorises every request each tab makes.
 */
const hasRole = (me, ...codes) => me.context.roles.some((r) => codes.includes(r.code));
const AFTER_FINAL = ['FINAL_APPROVED', 'CLIENT_APPROVAL_PENDING', 'CLIENT_QUERY_RAISED', 'CLIENT_APPROVED', 'CLIENT_SIGNED', 'SUBMITTED_TO_BANK', 'LOAN_SANCTIONED', 'DISBURSED', 'CASE_COMPLETED'];
const AT_BANK = ['SUBMITTED_TO_BANK', 'LOAN_SANCTIONED', 'DISBURSED', 'CASE_COMPLETED', 'CASE_REJECTED'];

export const CASE_TABS = [
  { key: 'overview', label: 'Overview', Component: OverviewTab, show: () => true },
  { key: 'client', label: 'Client details', Component: ClientTab, show: ({ isClient }) => !isClient },
  { key: 'property', label: 'Property details', Component: PropertyTab, show: ({ isClient }) => !isClient },
  { key: 'inspection', label: 'Inspection', Component: InspectionTab, show: ({ isClient }) => !isClient },
  { key: 'documents', label: 'Documents', Component: DocumentsTab, show: ({ can }) => can('document.view') },
  { key: 'preliminary', label: 'Preliminary valuation', Component: PreliminaryTab, show: ({ me }) => hasRole(me, 'FIRM_ADMIN', 'JUNIOR_REVIEWER', 'SENIOR_REVIEWER') },
  {
    key: 'senior',
    label: 'Senior review',
    Component: SeniorReviewTab,
    show: ({ me, c, isClient }) => !isClient && (hasRole(me, 'FIRM_ADMIN', 'JUNIOR_REVIEWER', 'SENIOR_REVIEWER') || AFTER_FINAL.includes(c.status)),
  },
  { key: 'approval', label: 'Client approval', Component: ApprovalTab, show: ({ c, isClient, me }) => isClient || hasRole(me, 'FIRM_ADMIN', 'SENIOR_REVIEWER', 'MARKETING') || AFTER_FINAL.includes(c.status) },
  { key: 'bank', label: 'Bank submission', Component: BankSubmissionTab, show: ({ c, isClient }) => !isClient || AT_BANK.includes(c.status) },
  { key: 'loan', label: 'Sanction & disbursement', Component: SanctionDisbursementTab, show: ({ c }) => AT_BANK.includes(c.status) },
  { key: 'timeline', label: 'Activity timeline', Component: TimelineTab, show: () => true },
];
