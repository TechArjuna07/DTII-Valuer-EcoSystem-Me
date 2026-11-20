import OverviewTab from './OverviewTab';
import ClientTab from './ClientTab';
import TimelineTab from './TimelineTab';

/**
 * Case detail tabs, in display order. `show(ctx)` decides visibility per user (ctx = { c, me, can, isClient });
 * the API independently authorises every request each tab makes.
 */
export const CASE_TABS = [
  { key: 'overview', label: 'Overview', Component: OverviewTab, show: () => true },
  { key: 'client', label: 'Client details', Component: ClientTab, show: ({ isClient }) => !isClient },
  { key: 'timeline', label: 'Activity timeline', Component: TimelineTab, show: () => true },
];
