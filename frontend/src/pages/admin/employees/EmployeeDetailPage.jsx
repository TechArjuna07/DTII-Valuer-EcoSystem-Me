import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, Mail, Pencil, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { employeesApi } from '@/services/adminApi';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/overlays';
import { PageHeader } from '@/components/data/PageHeader';
import { StatusBadge } from '@/components/data/StatusBadge';
import { ErrorState } from '@/components/data/States';
import { InviteNotice } from '@/components/data/InviteNotice';
import { FormAlert } from '@/components/forms/FormAlert';
import { formatDate, formatDateTime } from '@/utils/format';
import { emptyToNull } from '@/utils/validation';
import { EmployeeForm } from './EmployeeForm';

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [invite, setInvite] = useState(null);
  const { data: e, isLoading, error, refetch } = useQuery({ queryKey: ['employees', 'detail', id], queryFn: () => employeesApi.get(id) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['firm', 'summary'] });
  };
  const action = useMutation({
    mutationFn: (kind) => employeesApi[kind](id),
    onSuccess: (res, kind) => {
      setConfirm(null);
      if (kind === 'resendInvite') {
        setInvite(res);
        toast.success('Invitation re-sent');
      } else toast.success({ deactivate: 'Employee deactivated', reactivate: 'Employee reactivated', unlock: 'Account unlocked' }[kind]);
      refresh();
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(err.message);
    },
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const isSelf = e.user.id === me.user.id;

  const save = async (v) => {
    setEditError(null);
    try {
      const { fullName, ...rest } = v;
      await employeesApi.update(id, { fullName, ...emptyToNull(rest), dateOfJoining: v.dateOfJoining || null });
      toast.success('Employee updated');
      setEditing(false);
      refresh();
    } catch (err) {
      setEditError(err);
    }
  };

  const rows = [
    ['Employee code', <span key="c" className="font-mono">{e.employeeCode}</span>],
    ['Email (login)', e.user.email],
    ['Phone', e.user.phone],
    ['Designation', e.designation],
    ['Department', e.department],
    ['Registration no.', e.registrationNo],
    ['Date of joining', e.dateOfJoining ? formatDate(e.dateOfJoining) : null],
    ['Last sign-in', e.user.lastLoginAt ? formatDateTime(e.user.lastLoginAt) : 'Never'],
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {e.user.fullName} <StatusBadge status={e.status === 'INACTIVE' ? 'INACTIVE' : e.user.status} />
            {e.user.locked && <StatusBadge status="LOCKED" label="Locked" />}
          </span>
        }
        crumbs={[{ label: 'Employees', href: '/employees' }, { label: e.employeeCode }]}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            {e.user.status === 'INVITED' && e.status === 'ACTIVE' && (
              <Button variant="outline" loading={action.isPending && action.variables === 'resendInvite'} onClick={() => action.mutate('resendInvite')}>
                <Mail /> Resend invite
              </Button>
            )}
            {e.user.locked && (
              <Button variant="outline" onClick={() => action.mutate('unlock')}>
                <LockOpen /> Unlock
              </Button>
            )}
            {!isSelf &&
              (e.status === 'ACTIVE' ? (
                <Button variant="outline" className="text-destructive" onClick={() => setConfirm('deactivate')}>
                  <UserX /> Deactivate
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setConfirm('reactivate')}>
                  <UserCheck /> Reactivate
                </Button>
              ))}
          </>
        }
      />
      {invite && <InviteNotice invite={invite} />}
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-sm">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {e.roles.map((r) => (
              <Badge key={r.code} tone="primary">
                {r.name}
              </Badge>
            ))}
            {e.user.locked && (
              <p className="mt-3 flex items-center gap-2 text-xs text-destructive">
                <Lock className="size-3.5" /> Locked after repeated wrong passwords.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Edit employee" description={`Login email ${e.user.email} cannot be changed here.`} className="max-w-3xl">
          <FormAlert error={editError} className="mb-4" />
          <EmployeeForm
            mode="edit"
            defaultValues={{
              fullName: e.user.fullName,
              phone: e.user.phone ?? '',
              designation: e.designation ?? '',
              department: e.department ?? '',
              registrationNo: e.registrationNo ?? '',
              dateOfJoining: e.dateOfJoining ? e.dateOfJoining.slice(0, 10) : '',
              roles: e.roles.map((r) => r.code),
            }}
            onSubmit={save}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'deactivate' ? `Deactivate ${e.user.fullName}?` : `Reactivate ${e.user.fullName}?`}
        description={
          confirm === 'deactivate'
            ? 'They are signed out of this firm immediately and cannot sign in until reactivated. Their history is kept.'
            : 'They will be able to sign in to this firm again with their existing roles.'
        }
        confirmLabel={confirm === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        destructive={confirm === 'deactivate'}
        loading={action.isPending}
        onConfirm={() => action.mutate(confirm)}
      />
    </>
  );
}
