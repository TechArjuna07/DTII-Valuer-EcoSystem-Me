import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/context/AuthContext';
import { casesApi, mastersApi } from '@/services/casesApi';
import { useListParams } from '@/hooks/useListParams';
import { Badge, Button, Card, NativeSelect } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { SearchInput } from '@/components/data/SearchInput';
import { EmptyState } from '@/components/data/States';
import { CaseStatusBadge } from '@/components/workflow/CaseStatusBadge';
import { STATUS_GROUPS } from '@/utils/caseStatus';
import { formatDate, formatINR } from '@/utils/format';

export default function CasesListPage() {
  const { can, me } = useAuth();
  const navigate = useNavigate();
  const isClient = !me.employee && !!me.client;
  const [params, set] = useListParams(['statusGroup', 'bankId', 'categoryId', 'financialYearId', 'assignedToMe', 'overdue']);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cases', params],
    queryFn: () => casesApi.list({ ...params, pageSize: 20 }),
    placeholderData: (prev) => prev,
  });
  const masters = useQuery({
    queryKey: ['masters', 'filters'],
    queryFn: async () => {
      const [banks, categories, fys] = await Promise.all([mastersApi.banks({ pageSize: 100 }), mastersApi.categories(), mastersApi.financialYears()]);
      return { banks: banks.items, categories: categories.items, fys: fys.items };
    },
    enabled: can('master.view'),
    staleTime: 300_000,
  });

  const columns = [
    {
      key: 'case',
      header: 'Case ID',
      cell: (c) => (
        <div>
          <p className="font-mono text-xs font-semibold">{c.caseNumber}</p>
          {c.priority !== 'NORMAL' && <Badge tone={c.priority === 'URGENT' ? 'danger' : 'warning'}>{c.priority.toLowerCase()}</Badge>}
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      cell: (c) => (
        <div>
          <p className="font-medium">{c.client.name}</p>
          <p className="text-xs text-muted-foreground">{c.category.name}</p>
        </div>
      ),
    },
    {
      key: 'bank',
      header: 'Bank / NBFC',
      cell: (c) => (
        <div>
          <p>{c.bank.name}</p>
          <p className="text-xs text-muted-foreground">{c.bank.branch ?? ''}</p>
        </div>
      ),
      className: 'hidden md:table-cell',
    },
    { key: 'fy', header: 'FY', cell: (c) => c.financialYear.code, className: 'hidden lg:table-cell' },
    { key: 'loan', header: 'Loan', cell: (c) => <span className="tabular">{c.loanAmount ? formatINR(c.loanAmount) : '—'}</span>, className: 'hidden xl:table-cell' },
    ...(!isClient
      ? [{ key: 'fo', header: 'Field officer', cell: (c) => c.assignees.FIELD?.name ?? <span className="text-muted-foreground">Unassigned</span>, className: 'hidden lg:table-cell' }]
      : []),
    { key: 'received', header: 'Received', cell: (c) => formatDate(c.receivedOn), className: 'hidden sm:table-cell' },
    { key: 'status', header: 'Status', cell: (c) => <CaseStatusBadge status={c.status} overdue={c.overdue} /> },
  ];

  return (
    <>
      <PageHeader
        title={isClient ? 'My valuation cases' : 'Valuation cases'}
        description={isClient ? 'Every valuation requested for you, with its current status.' : 'Every case has its own Case ID, workflow and document repository.'}
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
      <Card>
        <div className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-4 xl:flex xl:flex-wrap">
          <SearchInput value={params.search} onChange={(v) => set('search', v)} placeholder="Case ID, client, loan ref, city…" className="sm:col-span-2 xl:w-72" />
          <NativeSelect aria-label="Stage" className="xl:w-52" value={params.statusGroup} onChange={(e) => set('statusGroup', e.target.value)}>
            <option value="">All stages</option>
            {STATUS_GROUPS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
          {masters.data && (
            <>
              <NativeSelect aria-label="Bank" className="xl:w-48" value={params.bankId} onChange={(e) => set('bankId', e.target.value)}>
                <option value="">All banks / NBFCs</option>
                {masters.data.banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.branch ? ` – ${b.branch}` : ''}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect aria-label="Category" className="xl:w-44" value={params.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">All categories</option>
                {masters.data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect aria-label="Financial year" className="xl:w-36" value={params.financialYearId} onChange={(e) => set('financialYearId', e.target.value)}>
                <option value="">All FYs</option>
                {masters.data.fys.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            </>
          )}
          {!isClient && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={params.assignedToMe === 'true'} onChange={(e) => set('assignedToMe', e.target.checked ? 'true' : '')} /> Assigned to me
            </label>
          )}
          {!isClient && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={params.overdue === 'true'} onChange={(e) => set('overdue', e.target.checked ? 'true' : '')} /> Overdue only
            </label>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={data?.items}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          onRowClick={(c) => navigate(`/cases/${c.id}`)}
          empty={<EmptyState icon={<FolderKanban className="size-5" />} title="No cases found" description={can('case.create') ? 'Register a new case when a loan file arrives.' : 'Cases assigned to you will appear here.'} />}
          page={data?.page}
          totalPages={data?.totalPages}
          total={data?.total}
          onPageChange={(p) => set('page', p)}
        />
      </Card>
    </>
  );
}
