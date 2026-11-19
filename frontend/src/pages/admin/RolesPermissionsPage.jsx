import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { Fragment } from 'react';
import { toast } from 'sonner';
import { firmApi } from '@/services/adminApi';
import { Card, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { ErrorState } from '@/components/data/States';
import { cn } from '@/utils/cn';
import { humanize } from '@/utils/format';

/**
 * Role × permission matrix. Non-critical permissions can be toggled per firm; critical ones (approvals,
 * signatures, inspection submission, administration) are locked by the platform to protect workflow integrity.
 */
export default function RolesPermissionsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['firm', 'rbac'], queryFn: firmApi.rbac });
  const toggle = useMutation({
    mutationFn: ({ role, perm, granted }) => firmApi.setPermission(role, perm, granted),
    onSuccess: (matrix) => {
      qc.setQueryData(['firm', 'rbac'], matrix);
      toast.success('Permission updated. Affected users get the change within seconds.');
    },
    onError: (e) => toast.error(e.message),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const modules = data ? [...new Set(data.permissions.map((p) => p.module))] : [];

  return (
    <>
      <PageHeader title="Roles & permissions" description="Adjust what each role may do in your firm. Locked permissions are fixed by the platform." />
      <Card className="overflow-x-auto">
        {isLoading ? (
          <Skeleton className="m-5 h-96" />
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">
                  Permission
                </th>
                {data.roles.map((r) => (
                  <th key={r.code} scope="col" className="px-2 py-3 text-center font-medium" title={r.description}>
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <Fragment key={m}>
                  <tr className="bg-muted/50">
                    <th colSpan={data.roles.length + 1} scope="colgroup" className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {humanize(m)}
                    </th>
                  </tr>
                  {data.permissions
                    .filter((p) => p.module === m)
                    .map((p) => (
                      <tr key={p.code} className="border-b last:border-0">
                        <td className="px-4 py-2.5">
                          <p className="flex items-center gap-1.5 font-medium">
                            {p.description} {p.isCritical && <Lock className="size-3.5 text-muted-foreground" aria-label="Locked by platform" />}
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">{p.code}</p>
                        </td>
                        {data.roles.map((r) => {
                          const g = p.grants[r.code];
                          const busy = toggle.isPending && toggle.variables?.role === r.code && toggle.variables?.perm === p.code;
                          return (
                            <td key={r.code} className="px-2 py-2.5 text-center">
                              <input
                                type="checkbox"
                                className={cn('size-4 accent-[var(--primary)]', p.isCritical ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}
                                checked={g.granted}
                                disabled={p.isCritical || busy}
                                onChange={(e) => toggle.mutate({ role: r.code, perm: p.code, granted: e.target.checked })}
                                aria-label={`${p.description} for ${r.name}`}
                              />
                              {g.overridden && <span className="ml-1 text-[10px] font-semibold text-warning" title="Changed from the platform default">●</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        <span className="font-semibold text-warning">●</span> differs from the platform default. Data scope still applies: e.g. field officers only ever see cases assigned to them.
      </p>
    </>
  );
}
