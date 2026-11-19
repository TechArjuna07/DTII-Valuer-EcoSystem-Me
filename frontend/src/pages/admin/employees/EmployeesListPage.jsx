import { useQuery } from '@tanstack/react-query';
import { Lock, UserPlus, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { employeesApi } from '@/services/adminApi';
import { useListParams } from '@/hooks/useListParams';
import { Badge, Button, Card, NativeSelect } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { SearchInput } from '@/components/data/SearchInput';
import { StatusBadge } from '@/components/data/StatusBadge';
import { EmptyState } from '@/components/data/States';
import { formatDateTime } from '@/utils/format';
import { STAFF_ROLES } from './roles';

export default function EmployeesListPage() {
  const navigate = useNavigate();
  const [params, set] = useListParams(['role', 'status']);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['employees', params],
    queryFn: () => employeesApi.list({ page: params.page, search: params.search, role: params.role, status: params.status }),
    placeholderData: (prev) => prev,
  });
  const columns = [
    { key: 'code', header: 'Code', cell: (e) => <span className="font-mono text-xs">{e.employeeCode}</span> },
    {
      key: 'name',
      header: 'Employee',
      cell: (e) => (
        <div>
          <p className="flex items-center gap-1.5 font-medium">
            {e.user.fullName} {e.user.locked && <Lock className="size-3.5 text-destructive" aria-label="Locked" />}
          </p>
          <p className="text-xs text-muted-foreground">{e.user.email}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (e) => (
        <div className="flex flex-wrap gap-1">
          {e.roles.map((r) => (
            <Badge key={r.code} tone="primary">
              {r.name}
            </Badge>
          ))}
        </div>
      ),
    },
    { key: 'designation', header: 'Designation', cell: (e) => e.designation ?? '—', className: 'hidden lg:table-cell' },
    { key: 'login', header: 'Last sign-in', cell: (e) => (e.user.lastLoginAt ? formatDateTime(e.user.lastLoginAt) : '—'), className: 'hidden md:table-cell' },
    {
      key: 'status',
      header: 'Status',
      cell: (e) => <StatusBadge status={e.status === 'INACTIVE' ? 'INACTIVE' : e.user.status} />,
    },
  ];
  return (
    <>
      <PageHeader
        title="Employees"
        description="Marketing staff, field officers and technical reviewers of your firm."
        actions={
          <Button asChild>
            <Link to="/employees/new">
              <UserPlus /> Add employee
            </Link>
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
          <SearchInput value={params.search} onChange={(v) => set('search', v)} placeholder="Search name, email, code…" />
          <NativeSelect aria-label="Filter by role" className="sm:w-56" value={params.role} onChange={(e) => set('role', e.target.value)}>
            <option value="">All roles</option>
            {STAFF_ROLES.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
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
          onRowClick={(e) => navigate(`/employees/${e.id}`)}
          empty={<EmptyState icon={<Users className="size-5" />} title="No employees found" description="Add marketing staff, field officers and reviewers to start assigning cases." />}
          page={data?.page}
          totalPages={data?.totalPages}
          total={data?.total}
          onPageChange={(p) => set('page', p)}
        />
      </Card>
    </>
  );
}
