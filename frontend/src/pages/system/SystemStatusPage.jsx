import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Database, RefreshCw, Server, XCircle, Zap } from 'lucide-react';
import { getReadiness } from '@/services/systemApi';
import { Badge, Button, Card, Skeleton } from '@/components/ui/primitives';

const ROWS = [
  { key: 'api', label: 'API server', icon: Server },
  { key: 'database', label: 'PostgreSQL database', icon: Database },
  { key: 'redis', label: 'Redis (cache & queues)', icon: Zap },
];

/** Live dependency status from GET /api/v1/health/ready. Public; reveals only up/down. */
export default function SystemStatusPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['system', 'readiness'],
    queryFn: getReadiness,
    refetchInterval: 30_000,
    retry: false,
  });

  const stateOf = (key) => {
    if (isError) return key === 'api' ? 'down' : 'unknown';
    if (key === 'api') return 'up';
    return data?.checks?.[key] ?? (data?.degraded ? 'down' : 'unknown');
  };
  const allUp = !isError && data?.status === 'ok';

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
      <p className="mt-1 text-sm text-muted-foreground">Checks that the platform services are reachable.</p>
      <Card className="mt-6 divide-y">
        {ROWS.map((r) => {
          const s = stateOf(r.key);
          return (
            <div key={r.key} className="flex items-center gap-3 px-4 py-3">
              <r.icon className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex-1 text-sm font-medium">{r.label}</span>
              {isLoading ? (
                <Skeleton className="h-5 w-16" />
              ) : s === 'up' ? (
                <Badge tone="success">
                  <CheckCircle2 className="size-3" /> Up
                </Badge>
              ) : s === 'down' ? (
                <Badge tone="danger">
                  <XCircle className="size-3" /> Down
                </Badge>
              ) : (
                <Badge>Unknown</Badge>
              )}
            </div>
          );
        })}
      </Card>
      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm" role="status">
          {isLoading ? 'Checking…' : allUp ? 'All systems operational.' : 'Some services are unavailable.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching} aria-label="Re-check status">
          {!isFetching && <RefreshCw />} Re-check
        </Button>
      </div>
    </>
  );
}
