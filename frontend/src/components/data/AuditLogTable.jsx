import { useQuery } from '@tanstack/react-query';
import { useListParams } from '@/hooks/useListParams';
import { formatDateTime, humanize } from '@/utils/format';
import { Card, NativeSelect } from '@/components/ui/primitives';
import { DataTable } from './DataTable';
import { EmptyState } from './States';

const ACTIONS = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'TOKEN_REUSE_DETECTED',
  'PASSWORD_RESET_COMPLETED',
  'INVITE_ACCEPTED',
  'FIRM_REGISTERED',
  'FIRM_STATUS_CHANGED',
  'EMPLOYEE_REGISTERED',
  'EMPLOYEE_ROLES_CHANGED',
  'EMPLOYEE_DEACTIVATED',
  'CLIENT_CREATED',
  'CLIENT_UPDATED',
  'CLIENT_PORTAL_ACCESS_GRANTED',
  'PERMISSIONS_CHANGED',
];

/** Read-only, append-only audit trail viewer (firm or platform scope decided by `fetcher`). */
export function AuditLogTable({ fetcher, queryKey, showFirm }) {
  const [params, set] = useListParams(['action']);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...queryKey, params],
    queryFn: () => fetcher({ page: params.page, pageSize: 25, action: params.action || undefined }),
    placeholderData: (prev) => prev,
  });
  const columns = [
    { key: 'at', header: 'When', cell: (r) => <span className="tabular whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt)}</span> },
    { key: 'action', header: 'Action', cell: (r) => <span className="font-medium">{humanize(r.action)}</span> },
    {
      key: 'actor',
      header: 'By',
      cell: (r) => (r.actor ? <span title={r.actor.email}>{r.actor.fullName}</span> : <span className="text-muted-foreground">System / anonymous</span>),
    },
    { key: 'role', header: 'Role', cell: (r) => (r.actorRole ? humanize(r.actorRole) : '—') },
    ...(showFirm ? [{ key: 'firm', header: 'Firm', cell: (r) => <span className="font-mono text-xs">{r.firmId ? r.firmId.slice(0, 8) : 'platform'}</span> }] : []),
    { key: 'entity', header: 'Record', cell: (r) => (r.entityType ? humanize(r.entityType) : '—') },
    { key: 'ip', header: 'IP', cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.ip ?? '—'}</span> },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <NativeSelect aria-label="Filter by action" className="w-full sm:w-64" value={params.action} onChange={(e) => set('action', e.target.value)}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {humanize(a)}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">Audit records are append-only and cannot be edited or deleted.</p>
      </div>
      <DataTable
        columns={columns}
        rows={data?.items}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        empty={<EmptyState title="No audit records" description="Nothing matches this filter yet." />}
        page={data?.page}
        totalPages={data?.totalPages}
        total={data?.total}
        onPageChange={(p) => set('page', p)}
      />
    </Card>
  );
}
