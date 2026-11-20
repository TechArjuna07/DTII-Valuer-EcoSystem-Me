import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, ClipboardList, MapPin, Phone } from 'lucide-react';
import { Link } from 'react-router';
import { inspectionsApi } from '@/services/inspectionsApi';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { StatCard } from '@/components/data/StatCard';
import { EmptyState, ErrorState } from '@/components/data/States';
import { CaseStatusBadge } from '@/components/workflow/CaseStatusBadge';
import { formatDate, formatDateTime } from '@/utils/format';

function InspectionCard({ c }) {
  return (
    <Link to={`/cases/${c.id}?tab=inspection`} className="block rounded-xl border bg-card p-4 transition hover:border-primary/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">{c.caseNumber}</span>
        {c.priority !== 'NORMAL' && <Badge tone={c.priority === 'URGENT' ? 'danger' : 'warning'}>{c.priority.toLowerCase()}</Badge>}
        <span className="ml-auto">
          <CaseStatusBadge status={c.status} />
        </span>
      </div>
      <p className="mt-2 font-medium">{c.client.name}</p>
      <p className="text-xs text-muted-foreground">
        {c.category.name} · {c.bank.shortCode}
      </p>
      {(c.propertyAddress || c.propertyCity) && (
        <p className="mt-2 flex items-start gap-1.5 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {[c.propertyAddress, c.propertyCity].filter(Boolean).join(', ')}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {c.inspection?.scheduledAt && (
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3.5" /> {formatDateTime(c.inspection.scheduledAt)}
          </span>
        )}
        {c.client.phone && (
          <a href={`tel:${c.client.phone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-primary">
            <Phone className="size-3.5" /> {c.client.phone}
          </a>
        )}
        {c.dueDate && <span>Due {formatDate(c.dueDate)}</span>}
      </div>
    </Link>
  );
}

/** Field officer dashboard: assigned, today's, pending and completed inspections (mobile-first). */
export default function MyInspectionsPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['inspections', 'mine'], queryFn: inspectionsApi.mine, refetchInterval: 120_000 });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const v = (n) => (isLoading ? <Skeleton className="h-8 w-10" /> : n);
  return (
    <>
      <PageHeader title="My inspections" description="Site visits assigned to you." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Assigned" value={v(data?.counts.assigned)} icon={<ClipboardList />} />
        <StatCard label="Today" value={v(data?.today.length)} icon={<CalendarClock />} />
        <StatCard label="Pending" value={v(data?.pending.length)} icon={<MapPin />} />
        <StatCard label="Completed" value={v(data?.completed.length)} icon={<CheckCircle2 />} />
      </div>
      {isLoading ? (
        <Skeleton className="mt-6 h-64" />
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">{data.today.length ? data.today.map((c) => <InspectionCard key={c.id} c={c} />) : <EmptyState title="No visits scheduled today" />}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pending</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">{data.pending.length ? data.pending.map((c) => <InspectionCard key={c.id} c={c} />) : <EmptyState title="Nothing pending" />}</CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Recently completed</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">{data.completed.length ? data.completed.map((c) => <InspectionCard key={c.id} c={c} />) : <EmptyState title="No completed inspections yet" />}</CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
