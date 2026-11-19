import { useQuery } from '@tanstack/react-query';
import { Building2, KeyRound, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/context/AuthContext';
import { clientsApi } from '@/services/adminApi';
import { useListParams } from '@/hooks/useListParams';
import { Button, Card, NativeSelect } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { SearchInput } from '@/components/data/SearchInput';
import { StatusBadge } from '@/components/data/StatusBadge';
import { EmptyState } from '@/components/data/States';
import { formatDate } from '@/utils/format';
import { CLIENT_TYPES } from './ClientForm';

const TYPE_LABEL = Object.fromEntries(CLIENT_TYPES);

export default function ClientsListPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, set] = useListParams(['status', 'clientType']);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['clients', params],
    queryFn: () => clientsApi.list({ page: params.page, search: params.search, status: params.status, clientType: params.clientType }),
    placeholderData: (prev) => prev,
  });
  const columns = [
    { key: 'code', header: 'Code', cell: (c) => <span className="font-mono text-xs">{c.clientCode}</span> },
    {
      key: 'name',
      header: 'Client',
      cell: (c) => (
        <div>
          <p className="flex items-center gap-1.5 font-medium">
            {c.name} {c.portalUser && <KeyRound className="size-3.5 text-primary" aria-label="Has portal login" />}
          </p>
          <p className="text-xs text-muted-foreground">{[c.contactPerson, c.phone].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', cell: (c) => TYPE_LABEL[c.clientType], className: 'hidden md:table-cell' },
    { key: 'pan', header: 'PAN', cell: (c) => <span className="font-mono text-xs">{c.panMasked ?? '—'}</span>, className: 'hidden lg:table-cell' },
    { key: 'city', header: 'City', cell: (c) => c.city ?? '—', className: 'hidden lg:table-cell' },
    { key: 'since', header: 'Added', cell: (c) => formatDate(c.createdAt), className: 'hidden sm:table-cell' },
    { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Clients"
        description="Loan applicants and property owners. A client can have many valuation cases."
        actions={
          can('client.manage') && (
            <Button asChild>
              <Link to="/clients/new">
                <Plus /> Add client
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
          <SearchInput value={params.search} onChange={(v) => set('search', v)} placeholder="Name, code, phone, email or full PAN…" />
          <NativeSelect aria-label="Filter by type" className="sm:w-48" value={params.clientType} onChange={(e) => set('clientType', e.target.value)}>
            <option value="">All types</option>
            {CLIENT_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Filter by status" className="sm:w-40" value={params.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </NativeSelect>
        </div>
        <DataTable
          columns={columns}
          rows={data?.items}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          onRowClick={(c) => navigate(`/clients/${c.id}`)}
          empty={<EmptyState icon={<Building2 className="size-5" />} title="No clients found" description={params.search ? 'Try another search.' : 'Register your first client.'} />}
          page={data?.page}
          totalPages={data?.totalPages}
          total={data?.total}
          onPageChange={(p) => set('page', p)}
        />
      </Card>
    </>
  );
}
