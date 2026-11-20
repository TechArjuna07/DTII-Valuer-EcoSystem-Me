import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { notificationsApi } from '@/services/analyticsApi';
import { useListParams } from '@/hooks/useListParams';
import { Button, Card } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { EmptyState } from '@/components/data/States';
import { formatDateTime } from '@/utils/format';

export default function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, set] = useListParams(['unreadOnly']);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['notifications', 'page', params], queryFn: () => notificationsApi.list({ page: params.page, pageSize: 25, unreadOnly: params.unreadOnly || undefined }), placeholderData: (p) => p });
  const readAll = useMutation({ mutationFn: notificationsApi.readAll, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const read = useMutation({ mutationFn: (id) => notificationsApi.read(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const columns = [
    { key: 'dot', header: '', cell: (n) => (!n.readAt ? <span className="block size-2 rounded-full bg-primary" aria-label="Unread" /> : null), className: 'w-6' },
    {
      key: 'title',
      header: 'Notification',
      cell: (n) => (
        <div>
          <p className={n.readAt ? '' : 'font-semibold'}>{n.title}</p>
          <p className="text-xs text-muted-foreground">{n.body}</p>
        </div>
      ),
    },
    { key: 'at', header: 'When', cell: (n) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(n.createdAt)}</span>, className: 'hidden sm:table-cell' },
  ];
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={params.unreadOnly === 'true'} onChange={(e) => set('unreadOnly', e.target.checked ? 'true' : '')} /> Unread only
            </label>
            <Button variant="outline" loading={readAll.isPending} onClick={() => readAll.mutate()}>
              <CheckCheck /> Mark all read
            </Button>
          </>
        }
      />
      <Card>
        <DataTable
          columns={columns}
          rows={data?.items}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          onRowClick={(n) => {
            if (!n.readAt) read.mutate(n.id);
            if (n.link) navigate(n.link);
          }}
          empty={<EmptyState icon={<BellOff className="size-5" />} title="No notifications" />}
          page={data?.page}
          totalPages={data?.totalPages}
          total={data?.total}
          onPageChange={(p) => set('page', p)}
        />
      </Card>
    </>
  );
}
