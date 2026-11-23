import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardCheck, FilePlus2, FileSearch, FileSignature, FolderKanban, IndianRupee, MapPin, Plus, Scale, Send, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/context/AuthContext';
import { analyticsApi } from '@/services/analyticsApi';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { StatCard } from '@/components/data/StatCard';
import { BarList } from '@/components/data/BarList';
import { ErrorState } from '@/components/data/States';
import { CaseStatusBadge } from '@/components/workflow/CaseStatusBadge';
import { CASE_STATUS, STAGE_LABEL } from '@/utils/caseStatus';
import { formatDate } from '@/utils/format';

const TILE_SETS = {
  FIRM_ADMIN: [
    ['total', 'Total cases', FolderKanban, '/cases'],
    ['newCases', 'New cases', FilePlus2, '/cases?statusGroup=NEW'],
    ['pendingInspection', 'Pending inspection', MapPin, '/cases?statusGroup=INSPECTION'],
    ['inspectionCompleted', 'Inspection completed', ClipboardCheck, '/cases?statusGroup=PRELIMINARY'],
    ['preliminaryPending', 'Preliminary review pending', FileSearch, '/cases?statusGroup=PRELIMINARY'],
    ['seniorPending', 'Senior review pending', Scale, '/cases?statusGroup=SENIOR_REVIEW'],
    ['awaitingSignature', 'Awaiting valuer signature', FileSignature, '/cases?statusGroup=AWAITING_SIGNATURE'],
    ['awaitingPayment', 'Signed – payment pending', IndianRupee, '/cases?statusGroup=AWAITING_PAYMENT'],
    ['completed', 'Completed (report signed)', CheckCircle2, '/cases?statusGroup=CLOSED'],
    ['overdue', 'Overdue', AlertTriangle, '/cases?overdue=true'],
  ],
  MARKETING: [
    ['received', 'Cases received', FolderKanban, '/cases'],
    ['pendingAssignment', 'Pending field assignment', MapPin, '/cases?statusGroup=NEW'],
    ['awaitingDocuments', 'Awaiting client documents', FileSearch, '/cases'],
    ['inValuation', 'In valuation', Scale, '/cases?statusGroup=ACTIVE'],
    ['awaitingPayment', 'Signed – payment pending', IndianRupee, '/cases?statusGroup=AWAITING_PAYMENT'],
    ['completed', 'Completed (report signed)', CheckCircle2, '/cases?statusGroup=CLOSED'],
  ],
  JUNIOR_REVIEWER: [
    ['pendingReviews', 'Pending reviews', FileSearch, '/cases?assignedToMe=true&statusGroup=PRELIMINARY'],
    ['inProgress', 'In-progress valuations', Scale, '/cases?assignedToMe=true&statusGroup=PRELIMINARY'],
    ['returned', 'Returned for correction', AlertTriangle, '/cases?assignedToMe=true&statusGroup=PRELIMINARY'],
    ['submitted', 'Submitted reports', Send, '/cases?assignedToMe=true&statusGroup=SENIOR_REVIEW'],
  ],
  SENIOR_REVIEWER: [
    ['pendingApprovals', 'Pending approvals', FileSearch, '/cases?assignedToMe=true&statusGroup=SENIOR_REVIEW'],
    ['underReview', 'Reports under review', Scale, '/cases?assignedToMe=true&statusGroup=SENIOR_REVIEW'],
    ['returned', 'Returned reports', AlertTriangle, '/cases?assignedToMe=true&statusGroup=PRELIMINARY'],
    ['awaitingSignature', 'Awaiting your signature', FileSignature, '/cases?assignedToMe=true&statusGroup=AWAITING_SIGNATURE'],
    ['approved', 'Approved reports', CheckCircle2, '/cases?assignedToMe=true'],
  ],
};

function AdminAnalytics({ d }) {
  const statuses = Object.entries(d.byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => ({ key: s, label: CASE_STATUS[s]?.label ?? s, value: n }));
  const months = d.monthlyIntake.map((m) => ({ key: m.month, label: new Date(`${m.month}-01`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }), value: m.cases }));
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Cases by status</CardTitle>
          <CardDescription>All cases of the firm, current status.</CardDescription>
        </CardHeader>
        <CardContent>
          <BarList items={statuses} ariaLabel="Cases by status" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>New cases per month</CardTitle>
          <CardDescription>Last six months.</CardDescription>
        </CardHeader>
        <CardContent>
          <BarList items={months} ariaLabel="New cases per month" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Employee workload</CardTitle>
          <Link to="/team" className="text-sm font-medium text-primary hover:underline">
            Team overview
          </Link>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2 font-medium">Employee</th>
                {['MARKETING', 'FIELD', 'JUNIOR', 'SENIOR'].map((s) => (
                  <th key={s} className="px-2 py-2 text-right font-medium">
                    {STAGE_LABEL[s]}
                  </th>
                ))}
                <th className="px-5 py-2 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {d.workload.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                    No open assignments
                  </td>
                </tr>
              )}
              {d.workload.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="px-5 py-2">
                    {e.name} <span className="font-mono text-[10px] text-muted-foreground">{e.employeeCode}</span>
                  </td>
                  {['MARKETING', 'FIELD', 'JUNIOR', 'SENIOR'].map((s) => (
                    <td key={s} className="tabular px-2 py-2 text-right">
                      {e.stages[s] ?? '–'}
                    </td>
                  ))}
                  <td className="tabular px-5 py-2 text-right font-semibold">{e.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Average time in each stage</CardTitle>
          <CardDescription>Hours, last 180 days (from the status history).</CardDescription>
        </CardHeader>
        <CardContent>
          <BarList
            items={d.turnaround.filter((t) => CASE_STATUS[t.status]).sort((a, b) => b.hours - a.hours).map((t) => ({ key: t.status, label: CASE_STATUS[t.status].label, value: t.hours }))}
            format={(h) => `${h.toLocaleString('en-IN')} h`}
            emptyText="Not enough completed stages yet"
            ariaLabel="Average hours per stage"
          />
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Recent cases</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {d.recent.map((c) => (
              <li key={c.id}>
                <Link to={`/cases/${c.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-accent/60">
                  <span className="font-mono text-xs font-semibold">{c.caseNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{c.client.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.bank.shortCode} · {formatDate(c.createdAt)}
                  </span>
                  <CaseStatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/** Role-specific dashboard (Firm Admin, Marketing, Junior / Senior reviewer). Field officers use My inspections. */
export default function DashboardPage() {
  const { me, can } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: analyticsApi.dashboard, refetchInterval: 120_000 });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const tiles = TILE_SETS[data?.role] ?? [];
  return (
    <>
      <PageHeader
        title={`Welcome, ${me.user.fullName.split(' ')[0]}`}
        description={`${me.context.firm.name} · ${me.context.roles.map((r) => r.name).join(', ')}`}
        actions={
          can('case.create') && (
            <Button asChild>
              <Link to="/cases/new">
                <Plus /> New case
              </Link>
            </Button>
          )
        }
      />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {tiles.map(([key, label, Icon, href]) => (
              <StatCard key={key} label={label} value={data.tiles[key] ?? 0} icon={<Icon />} href={href} />
            ))}
          </div>
          {data.role === 'FIRM_ADMIN' ? (
            <AdminAnalytics d={data} />
          ) : (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>My cases by status</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  items={Object.entries(data.byStatus)
                    .sort((a, b) => b[1] - a[1])
                    .map(([s, n]) => ({ key: s, label: CASE_STATUS[s]?.label ?? s, value: n }))}
                  emptyText="No cases assigned to you yet"
                  ariaLabel="My cases by status"
                />
              </CardContent>
            </Card>
          )}
          {data.role === 'FIRM_ADMIN' && (
            <p className="mt-4 text-xs text-muted-foreground">
              <Users className="mr-1 inline size-3.5" /> Team, invitations and clients: see <Link to="/team" className="text-primary hover:underline">Team overview</Link>.
            </p>
          )}
        </>
      )}
    </>
  );
}
