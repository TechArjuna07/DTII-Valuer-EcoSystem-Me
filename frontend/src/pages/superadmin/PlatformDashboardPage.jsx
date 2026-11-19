import { useQuery } from '@tanstack/react-query';
import { Building2, Landmark, PauseCircle, Plus, Users } from 'lucide-react';
import { Link } from 'react-router';
import { platformApi } from '@/services/adminApi';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { StatCard } from '@/components/data/StatCard';
import { StatusBadge } from '@/components/data/StatusBadge';
import { EmptyState, ErrorState } from '@/components/data/States';
import { formatDate } from '@/utils/format';

export default function PlatformDashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['platform', 'summary'], queryFn: platformApi.summary });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const v = (n) => (isLoading ? <Skeleton className="h-8 w-14" /> : n);
  return (
    <>
      <PageHeader
        title="Platform dashboard"
        description="Registered valuation firms and platform-wide totals. Firm case data stays private to each firm."
        actions={
          <Button asChild>
            <Link to="/platform/firms/new">
              <Plus /> Register firm
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Registered firms" value={v(data?.firms.total)} icon={<Landmark />} href="/platform/firms" />
        <StatCard label="Active firms" value={v(data?.firms.active)} icon={<Landmark />} hint={data ? `${data.firms.suspended} suspended · ${data.firms.deactivated} deactivated` : undefined} href="/platform/firms?status=ACTIVE" />
        <StatCard label="Employees (active firms)" value={v(data?.employees)} icon={<Users />} />
        <StatCard label="Clients (active firms)" value={v(data?.clients)} icon={<Building2 />} />
      </div>
      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recently registered firms</CardTitle>
          <Link to="/platform/firms" className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <Skeleton className="m-5 h-24" />}
          {data?.recentFirms.length === 0 && <EmptyState icon={<PauseCircle className="size-5" />} title="No firms yet" description="Register the first valuation firm to get started." />}
          <ul className="divide-y">
            {data?.recentFirms.map((f) => (
              <li key={f.id}>
                <Link to={`/platform/firms/${f.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/60">
                  <span className="font-mono text-xs text-muted-foreground">{f.firmCode}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.name}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{f.city ?? ''}</span>
                  <span className="hidden text-xs text-muted-foreground md:inline">{formatDate(f.createdAt)}</span>
                  <StatusBadge status={f.status} />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
