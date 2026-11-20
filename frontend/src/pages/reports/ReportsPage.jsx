import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { analyticsApi } from '@/services/analyticsApi';
import { mastersApi } from '@/services/casesApi';
import { Badge, Button, Card, Input, Label, NativeSelect } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { StatCard } from '@/components/data/StatCard';
import { EmptyState } from '@/components/data/States';
import { CaseStatusBadge } from '@/components/workflow/CaseStatusBadge';
import { STATUS_GROUPS } from '@/utils/caseStatus';
import { formatDate, formatINR } from '@/utils/format';

/** Case register report with filters and CSV export (scoped to the cases the user may see). */
export default function ReportsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ from: '', to: '', statusGroup: '', bankId: '', categoryId: '', financialYearId: '' });
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report', params], queryFn: () => analyticsApi.caseReport(params), placeholderData: (p) => p });
  const masters = useQuery({
    queryKey: ['masters', 'report-filters'],
    queryFn: async () => ({ banks: (await mastersApi.banks({ pageSize: 100 })).items, categories: (await mastersApi.categories()).items, fys: (await mastersApi.financialYears()).items }),
    enabled: can('master.view'),
  });
  const columns = [
    { key: 'case', header: 'Case ID', cell: (r) => <span className="font-mono text-xs">{r.caseNumber}</span> },
    { key: 'received', header: 'Received', cell: (r) => formatDate(r.receivedOn), className: 'hidden md:table-cell' },
    { key: 'client', header: 'Client', cell: (r) => r.client },
    { key: 'bank', header: 'Bank', cell: (r) => r.bank, className: 'hidden lg:table-cell' },
    { key: 'mv', header: 'Market value', cell: (r) => <span className="tabular">{r.marketValue != null ? formatINR(r.marketValue) : '—'}</span>, className: 'hidden md:table-cell' },
    { key: 'sanctioned', header: 'Sanctioned', cell: (r) => <span className="tabular">{r.sanctioned != null ? formatINR(r.sanctioned) : '—'}</span>, className: 'hidden xl:table-cell' },
    { key: 'status', header: 'Status', cell: (r) => <CaseStatusBadge status={r.status} overdue={r.overdue} /> },
  ];
  const field = (k, label, el) => (
    <div className="space-y-1.5">
      <Label htmlFor={`rf-${k}`} className="text-xs">
        {label}
      </Label>
      {el}
    </div>
  );
  return (
    <>
      <PageHeader
        title="Reports"
        description="Case register with valuation, sanction and disbursement figures."
        actions={
          <Button onClick={() => analyticsApi.downloadCaseReport(params).catch((e) => toast.error(e.message))}>
            <Download /> Export CSV
          </Button>
        }
      />
      <Card className="mb-6 grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {field('from', 'Received from', <Input id="rf-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />)}
        {field('to', 'Received to', <Input id="rf-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />)}
        {field(
          'statusGroup',
          'Stage',
          <NativeSelect id="rf-statusGroup" value={f.statusGroup} onChange={(e) => setF({ ...f, statusGroup: e.target.value })}>
            <option value="">All</option>
            {STATUS_GROUPS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>,
        )}
        {masters.data && (
          <>
            {field(
              'bankId',
              'Bank / NBFC',
              <NativeSelect id="rf-bankId" value={f.bankId} onChange={(e) => setF({ ...f, bankId: e.target.value })}>
                <option value="">All</option>
                {masters.data.banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.branch ? ` – ${b.branch}` : ''}
                  </option>
                ))}
              </NativeSelect>,
            )}
            {field(
              'categoryId',
              'Category',
              <NativeSelect id="rf-categoryId" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
                <option value="">All</option>
                {masters.data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>,
            )}
            {field(
              'financialYearId',
              'Financial year',
              <NativeSelect id="rf-financialYearId" value={f.financialYearId} onChange={(e) => setF({ ...f, financialYearId: e.target.value })}>
                <option value="">All</option>
                {masters.data.fys.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.label}
                  </option>
                ))}
              </NativeSelect>,
            )}
          </>
        )}
      </Card>
      {data && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Cases" value={data.totals.cases} />
          <StatCard label="Total market value" value={formatINR(data.totals.marketValue)} />
          <StatCard label="Total sanctioned" value={formatINR(data.totals.sanctioned)} />
          <StatCard label="Total disbursed" value={formatINR(data.totals.disbursed)} />
        </div>
      )}
      <Card>
        <DataTable columns={columns} rows={data?.rows.map((r) => ({ ...r, id: r.caseId }))} loading={isLoading} error={error} onRetry={refetch} onRowClick={(r) => navigate(`/cases/${r.caseId}`)} empty={<EmptyState title="No cases match these filters" />} />
        {data?.rows.length >= 5000 && (
          <p className="p-3 text-xs text-muted-foreground">
            <Badge tone="warning">limit</Badge> Showing the first 5,000 cases; narrow the filters.
          </p>
        )}
      </Card>
    </>
  );
}
