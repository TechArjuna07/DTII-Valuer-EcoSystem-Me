import OverviewTab from './OverviewTab';
import ClientTab from './ClientTab';
import TimelineTab from './TimelineTab';
import DocumentsTab from './DocumentsTab';
import PropertyTab from './PropertyTab';
import InspectionTab from './InspectionTab';

/**
 * Case detail tabs, in display order. `show(ctx)` decides visibility per user (ctx = { c, me, can, isClient });
 * the API independently authorises every request each tab makes.
 */
export const CASE_TABS = [
  { key: 'overview', label: 'Overview', Component: OverviewTab, show: () => true },
  { key: 'client', label: 'Client details', Component: ClientTab, show: ({ isClient }) => !isClient },
  { key: 'property', label: 'Property details', Component: PropertyTab, show: ({ isClient }) => !isClient },
  { key: 'inspection', label: 'Inspection', Component: InspectionTab, show: ({ isClient }) => !isClient },
  { key: 'documents', label: 'Documents', Component: DocumentsTab, show: ({ can }) => can('document.view') },
  { key: 'timeline', label: 'Activity timeline', Component: TimelineTab, show: () => true },
];
