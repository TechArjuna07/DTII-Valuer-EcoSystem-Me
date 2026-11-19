import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CirclePlay, KeyRound, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { clientsApi } from '@/services/adminApi';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/overlays';
import { PageHeader } from '@/components/data/PageHeader';
import { StatusBadge } from '@/components/data/StatusBadge';
import { ErrorState } from '@/components/data/States';
import { InviteNotice } from '@/components/data/InviteNotice';
import { FormAlert } from '@/components/forms/FormAlert';
import { formatDate, formatDateTime } from '@/utils/format';
import { emptyToNull } from '@/utils/validation';
import { CLIENT_TYPES, ClientForm } from './ClientForm';

const TYPE_LABEL = Object.fromEntries(CLIENT_TYPES);

export default function ClientDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [invite, setInvite] = useState(null);
  const { data: c, isLoading, error, refetch } = useQuery({ queryKey: ['clients', 'detail', id], queryFn: () => clientsApi.get(id) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['clients'] });
    qc.invalidateQueries({ queryKey: ['firm', 'summary'] });
  };
  const action = useMutation({
    mutationFn: (kind) => clientsApi[kind](id),
    onSuccess: (res, kind) => {
      setConfirm(null);
      if (kind === 'portalAccess') {
        setInvite(res);
        toast.success('Portal invitation sent');
      } else toast.success(kind === 'deactivate' ? 'Client deactivated' : 'Client reactivated');
      refresh();
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(err.message);
    },
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const manage = can('client.manage');

  const save = async (v) => {
    setEditError(null);
    try {
      // eslint-disable-next-line no-unused-vars
      const { createPortalLogin, pan, ...rest } = v;
      await clientsApi.update(id, { ...emptyToNull(rest), ...(pan ? { pan } : {}) });
      toast.success('Client updated');
      setEditing(false);
      refresh();
    } catch (err) {
      setEditError(err);
    }
  };

  const address = [c.addressLine1, c.addressLine2, c.city, c.state, c.pincode].filter(Boolean).join(', ');
  const rows = [
    ['Client code', <span key="c" className="font-mono">{c.clientCode}</span>],
    ['Type', TYPE_LABEL[c.clientType]],
    ['Contact person', c.contactPerson],
    ['Email', c.email],
    ['Mobile', c.phone],
    ['Alternate phone', c.altPhone],
    ['PAN', c.panMasked && <span className="font-mono">{c.panMasked}</span>],
    ['GSTIN', c.gstin],
    ['Address', address || null],
    ['Added on', formatDate(c.createdAt)],
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {c.name} <StatusBadge status={c.status} />
          </span>
        }
        crumbs={[{ label: 'Clients', href: '/clients' }, { label: c.clientCode }]}
        actions={
          manage && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              {c.status === 'ACTIVE' ? (
                <Button variant="outline" className="text-destructive" onClick={() => setConfirm('deactivate')}>
                  <Ban /> Deactivate
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setConfirm('reactivate')}>
                  <CirclePlay /> Reactivate
                </Button>
              )}
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Client details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-sm">{value || '—'}</dd>
                </div>
              ))}
            </dl>
            {c.notes && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{c.notes}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" /> Client portal
            </CardTitle>
            <CardDescription>Lets the client track cases, upload requested documents and sign reports.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {c.portalUser ? (
              <>
                <p className="flex items-center justify-between">
                  Login <span className="truncate pl-2">{c.portalUser.email}</span>
                </p>
                <p className="flex items-center justify-between">
                  Status <StatusBadge status={c.portalUser.status} />
                </p>
                <p className="flex items-center justify-between">
                  Last sign-in <span>{c.portalUser.lastLoginAt ? formatDateTime(c.portalUser.lastLoginAt) : 'Never'}</span>
                </p>
                {manage && c.portalUser.status === 'INVITED' && (
                  <Button variant="outline" size="sm" loading={action.isPending} onClick={() => action.mutate('portalAccess')}>
                    Resend invitation
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="text-muted-foreground">No portal login yet.</p>
                {manage && (
                  <Button size="sm" disabled={!c.email || c.status !== 'ACTIVE'} loading={action.isPending} onClick={() => action.mutate('portalAccess')}>
                    Create portal login
                  </Button>
                )}
                {!c.email && <p className="text-xs text-muted-foreground">Add an email address first.</p>}
              </>
            )}
            <InviteNotice invite={invite} />
          </CardContent>
        </Card>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Edit client" description={`${c.clientCode} · the client code cannot change.`} className="max-w-4xl">
          <FormAlert error={editError} className="mb-4" />
          <ClientForm
            mode="edit"
            panMasked={c.panMasked}
            defaultValues={Object.fromEntries(
              ['clientType', 'name', 'contactPerson', 'email', 'phone', 'altPhone', 'gstin', 'addressLine1', 'addressLine2', 'city', 'state', 'pincode', 'notes'].map((k) => [k, c[k] ?? '']),
            )}
            onSubmit={save}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'deactivate' ? `Deactivate ${c.name}?` : `Reactivate ${c.name}?`}
        description={confirm === 'deactivate' ? 'The client portal login is signed out and blocked. No records are deleted.' : 'The client and their portal login become active again.'}
        confirmLabel={confirm === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        destructive={confirm === 'deactivate'}
        loading={action.isPending}
        onConfirm={() => action.mutate(confirm)}
      />
    </>
  );
}
