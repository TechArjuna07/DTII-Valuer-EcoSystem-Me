import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';
import { useAuth } from '@/context/AuthContext';
import { casesApi } from '@/services/casesApi';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { PageHeader } from '@/components/data/PageHeader';
import { ErrorState } from '@/components/data/States';
import { CaseStatusBadge } from '@/components/workflow/CaseStatusBadge';
import { CASE_TABS } from './tabs';

/**
 * Case detail: header (Case ID, client, bank, FY, category, status) + role-filtered tabs.
 * Tabs only render what the API returns for this user; the API enforces every permission again.
 */
export default function CaseDetailPage() {
  const { id } = useParams();
  const { me, can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const { data: c, isLoading, error, refetch } = useQuery({ queryKey: ['cases', 'detail', id], queryFn: () => casesApi.get(id) });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-96 w-full" />;

  const ctx = { c, me, can, isClient: !me.employee && !!me.client };
  const tabs = CASE_TABS.filter((t) => t.show(ctx));
  const active = tabs.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : tabs[0].key;

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{c.caseNumber}</span>}
        crumbs={[{ label: ctx.isClient ? 'My cases' : 'Cases', href: '/cases' }, { label: c.caseNumber }]}
        description={`${c.client.name} · ${c.bank.name}${c.bank.branch ? ` (${c.bank.branch})` : ''}`}
        actions={<CaseStatusBadge status={c.status} overdue={c.overdue} />}
      />
      <Card className="mb-6 grid grid-cols-2 gap-4 p-4 text-sm md:grid-cols-5">
        {[
          ['Client', c.client.name],
          ['Bank / NBFC', c.bank.shortCode],
          ['Financial year', c.financialYear.label],
          ['Category', c.category.name],
          ['Priority', c.priority],
        ].map(([l, v]) => (
          <div key={l}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{l}</p>
            <p className="mt-0.5 truncate font-medium">{l === 'Priority' ? <Badge tone={v === 'NORMAL' ? 'neutral' : v === 'URGENT' ? 'danger' : 'warning'}>{v.toLowerCase()}</Badge> : v}</p>
          </div>
        ))}
      </Card>
      <Tabs value={active} onValueChange={(v) => setSp({ tab: v }, { replace: true })}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key}>
            <t.Component {...ctx} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
