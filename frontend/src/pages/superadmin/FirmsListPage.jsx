import { useQuery } from '@tanstack/react-query';
import { Landmark, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { platformApi } from '@/services/adminApi';
import { useListParams } from '@/hooks/useListParams';
import { Button, Card, NativeSelect } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { SearchInput } from '@/components/data/SearchInput';
import { StatusBadge } from '@/components/data/StatusBadge';
import { EmptyState } from '@/components/data/States';
import { formatDate } from '@/utils/format';

export default function FirmsListPage() {
  const navigate = useNavigate();
  const [params, set] = useListParams(['status']);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['platform', 'firms', params],
    queryFn: () => platformApi.listFirms({ page: params.page, search: params.search, status: params.status }),
    placeholderData: (prev) => prev,
  });
  const columns = [
    { key: 'code', header: 'Firm code', cell: (f) => <span className="font-mono text-xs">{f.firmCode}</span> },
    {
      key: 'name',
      header: 'Firm',
      cell: (f) => (
        <div>
          <p className="font-medium">{f.name}</p>
          <p className="text-xs text-muted-foreground">{f.email}</p>
        </div>
      ),
    },
    { key: 'city', header: 'City', cell: (f) => f.city ?? '—', className: 'hidden md:table-cell' },
    { key: 'emp', header: 'Employees', cell: (f) => <span className="tabular">{f.counts.employees}</span>, className: 'hidden sm:table-cell' },
    { key: 'cli', header: 'Clients', cell: (f) => <span className="tabular">{f.counts.clients}</span>, className: 'hidden sm:table-cell' },
    { key: 'plan', header: 'Plan', cell: (f) => <StatusBadge status={f.subscriptionStatus} label={`${f.subscriptionPlan}`} />, className: 'hidden lg:table-cell' },
    { key: 'since', header: 'Registered', cell: (f) => formatDate(f.createdAt), className: 'hidden lg:table-cell' },
    { key: 'status', header: 'Status', cell: (f) => <StatusBadge status={f.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Valuation firms"
        crumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Firms' }]}
        actions={
          <Button asChild>
            <Link to="/platform/firms/new">
              <Plus /> Register firm
            </Link>
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
          <SearchInput value={params.search} onChange={(v) => set('search', v)} placeholder="Search name, code, email, city…" />
          <NativeSelect aria-label="Filter by status" className="sm:w-48" value={params.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DEACTIVATED">Deactivated</option>
          </NativeSelect>
        </div>
        <DataTable
          columns={columns}
          rows={data?.items}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          onRowClick={(f) => navigate(`/platform/firms/${f.id}`)}
          empty={<EmptyState icon={<Landmark className="size-5" />} title="No firms found" description={params.search || params.status ? 'Try another search or filter.' : 'Register the first valuation firm.'} />}
          page={data?.page}
          totalPages={data?.totalPages}
          total={data?.total}
          onPageChange={(p) => set('page', p)}
        />
      </Card>
    </>
  );
}
