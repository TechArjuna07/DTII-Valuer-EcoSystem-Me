import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarRange, FolderClosed, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/context/AuthContext';
import { clientsApi } from '@/services/adminApi';
import { documentsApi } from '@/services/documentsApi';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { SearchInput } from '@/components/data/SearchInput';
import { EmptyState, ErrorState } from '@/components/data/States';
import { CaseStatusBadge } from '@/components/workflow/CaseStatusBadge';
import { FOLDERS } from '@/utils/folders';
import { cn } from '@/utils/cn';

function ClientTree({ clientId, portal }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['repository', clientId ?? 'me'],
    queryFn: () => (portal ? documentsApi.myRepository() : documentsApi.clientRepository(clientId)),
  });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-64" />;
  if (!data.years.length) return <EmptyState title="No cases yet" description="Folders are created automatically for every new case." />;
  return (
    <div className="space-y-5">
      {data.years.map((y) => (
        <div key={y.code}>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <CalendarRange className="size-4 text-primary" /> {y.label}
          </p>
          <div className="space-y-3 pl-6">
            {y.cases.map((c) => (
              <Card key={c.id}>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <FolderOpen className="size-4 text-primary" />
                    <Link to={`/cases/${c.id}?tab=documents`} className="font-mono text-sm font-semibold text-primary hover:underline">
                      {c.label}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {c.category} · {c.bank}
                    </span>
                    <span className="ml-auto">
                      <CaseStatusBadge status={c.status} />
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-5">
                    {FOLDERS.filter((f) => portal ? ['SOURCE_FILES', 'FINAL_VALUATION_REPORT', 'CLIENT_SIGNED_FILES'].includes(f.code) : true).map((f) => (
                      <span key={f.code} className={cn('flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px]', c.folderCounts[f.code] ? 'bg-primary-soft text-primary' : 'text-muted-foreground')}>
                        <FolderClosed className="size-3.5" /> {f.label} <span className="ml-auto tabular">{c.folderCounts[f.code] ?? 0}</span>
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Client-wise document repository: Client → Financial year → Case → 10 folders (from database metadata). */
export default function RepositoryPage() {
  const { me } = useAuth();
  const portal = !me.employee && !!me.client;
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState(null);
  const clients = useQuery({ queryKey: ['clients', 'repo', search], queryFn: () => clientsApi.list({ search, pageSize: 30 }), enabled: !portal });

  return (
    <>
      <PageHeader title={portal ? 'My documents' : 'Document repository'} description={portal ? 'Your documents, by financial year and case.' : 'Every client’s documents, by financial year and Case ID.'} />
      {portal ? (
        <ClientTree portal />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Clients</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <SearchInput value={search} onChange={setSearch} placeholder="Search clients…" className="sm:w-full" />
              <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
                {clients.data?.items.map((cl) => (
                  <li key={cl.id}>
                    <button onClick={() => setClientId(cl.id)} className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm', clientId === cl.id ? 'bg-primary-soft text-primary' : 'hover:bg-accent')}>
                      <Building2 className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{cl.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{cl.clientCode}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <div>{clientId ? <ClientTree clientId={clientId} /> : <EmptyState icon={<Building2 className="size-5" />} title="Select a client" description="Their repository opens here." />}</div>
        </div>
      )}
    </>
  );
}
