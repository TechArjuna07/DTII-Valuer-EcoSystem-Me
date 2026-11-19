import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CirclePlay, Mail, PauseCircle, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { platformApi } from '@/services/adminApi';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/overlays';
import { PageHeader } from '@/components/data/PageHeader';
import { StatusBadge } from '@/components/data/StatusBadge';
import { ErrorState } from '@/components/data/States';
import { InviteNotice } from '@/components/data/InviteNotice';
import { Field } from '@/components/forms/Field';
import { FormAlert } from '@/components/forms/FormAlert';
import { FirmFields, firmDefaults, firmFieldsSchema } from '@/components/forms/FirmFields';
import { formatDate, formatDateTime } from '@/utils/format';
import { emptyToNull } from '@/utils/validation';

const editSchema = z.object({
  ...firmFieldsSchema,
  subscriptionPlan: z.string().trim().min(1).max(40),
  subscriptionStatus: z.enum(['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED']),
  subscriptionValidTill: z.string().optional(),
});

function EditFirmDialog({ firm, open, onOpenChange }) {
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const form = useForm({
    resolver: zodResolver(editSchema),
    values: {
      ...firmDefaults(firm),
      subscriptionPlan: firm.subscriptionPlan,
      subscriptionStatus: firm.subscriptionStatus,
      subscriptionValidTill: firm.subscriptionValidTill ? firm.subscriptionValidTill.slice(0, 10) : '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await platformApi.updateFirm(firm.id, { ...emptyToNull(v), email: v.email, name: v.name });
      toast.success('Firm updated');
      qc.invalidateQueries({ queryKey: ['platform'] });
      onOpenChange(false);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Edit firm" description={`Firm code ${firm.firmCode} cannot be changed.`} className="max-w-3xl">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <FormAlert error={error} />
          <FirmFields register={form.register} errors={errors} idPrefix="edit" />
          <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
            <Field label="Plan" htmlFor="plan" error={errors.subscriptionPlan?.message}>
              <Input id="plan" {...form.register('subscriptionPlan')} />
            </Field>
            <Field label="Subscription status" htmlFor="substatus">
              <NativeSelect id="substatus" {...form.register('subscriptionStatus')}>
                {['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED'].map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Valid till" htmlFor="validtill">
              <Input id="validtill" type="date" {...form.register('subscriptionValidTill')} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Save changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusAction({ firm }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => platformApi.setFirmStatus(firm.id, target, reason),
    onSuccess: () => {
      toast.success('Firm status updated');
      setTarget(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const copy = {
    SUSPENDED: { title: 'Suspend this firm?', text: 'All of its users are signed out immediately and cannot sign in until the firm is reactivated. No data is deleted.', label: 'Suspend' },
    DEACTIVATED: { title: 'Deactivate this firm?', text: 'All of its users are signed out and the firm is closed. Its records are retained for audit.', label: 'Deactivate' },
    ACTIVE: { title: 'Reactivate this firm?', text: 'Its users will be able to sign in again.', label: 'Reactivate' },
  };
  return (
    <>
      {firm.status === 'ACTIVE' ? (
        <>
          <Button variant="outline" onClick={() => setTarget('SUSPENDED')}>
            <PauseCircle /> Suspend
          </Button>
          <Button variant="outline" className="text-destructive" onClick={() => setTarget('DEACTIVATED')}>
            <Ban /> Deactivate
          </Button>
        </>
      ) : (
        <Button variant="outline" onClick={() => setTarget('ACTIVE')}>
          <CirclePlay /> Reactivate
        </Button>
      )}
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={copy[target]?.title}
        description={copy[target]?.text}
        confirmLabel={copy[target]?.label}
        destructive={target !== 'ACTIVE'}
        loading={mutation.isPending}
        onConfirm={() => (reason.trim().length >= 3 ? mutation.mutate() : toast.error('Enter a reason (at least 3 characters)'))}
      >
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="status-reason">Reason (recorded in the audit log)</Label>
          <Textarea id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
      </ConfirmDialog>
    </>
  );
}

function AdminRow({ firmId, admin }) {
  const [invite, setInvite] = useState(null);
  const resend = useMutation({
    mutationFn: () => platformApi.resendAdminInvite(firmId, admin.id),
    onSuccess: (res) => {
      setInvite(res);
      toast.success('Invitation re-sent');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <li className="space-y-2 px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{admin.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {admin.email} · last sign-in {admin.lastLoginAt ? formatDateTime(admin.lastLoginAt) : 'never'}
          </p>
        </div>
        <StatusBadge status={admin.status} />
        {admin.status === 'INVITED' && (
          <Button size="sm" variant="outline" loading={resend.isPending} onClick={() => resend.mutate()}>
            <Mail /> Resend invite
          </Button>
        )}
      </div>
      <InviteNotice invite={invite} />
    </li>
  );
}

export default function FirmDetailPage() {
  const { id } = useParams();
  const [editing, setEditing] = useState(false);
  const { data: firm, isLoading, error, refetch } = useQuery({ queryKey: ['platform', 'firm', id], queryFn: () => platformApi.getFirm(id) });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const address = [firm.addressLine1, firm.addressLine2, firm.city, firm.state, firm.pincode].filter(Boolean).join(', ');
  const rows = [
    ['Firm code', <span key="c" className="font-mono">{firm.firmCode}</span>],
    ['Legal name', firm.legalName],
    ['Office email', firm.email],
    ['Phone', firm.phone],
    ['Registration no.', firm.registrationNo],
    ['GSTIN', firm.gstin],
    ['Address', address || null],
    ['Registered on', formatDate(firm.createdAt)],
  ];
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {firm.name} <StatusBadge status={firm.status} />
          </span>
        }
        crumbs={[{ label: 'Firms', href: '/platform/firms' }, { label: firm.firmCode }]}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <StatusAction firm={firm} />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Firm profile</CardTitle>
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
            <CardTitle>Subscription & usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="flex items-center justify-between">
              Plan <Badge tone="primary">{firm.subscriptionPlan}</Badge>
            </p>
            <p className="flex items-center justify-between">
              Status <StatusBadge status={firm.subscriptionStatus} />
            </p>
            <p className="flex items-center justify-between">
              Valid till <span>{formatDate(firm.subscriptionValidTill)}</span>
            </p>
            <p className="flex items-center justify-between border-t pt-3">
              Active employees <span className="tabular font-semibold">{firm.counts.employees}</span>
            </p>
            <p className="flex items-center justify-between">
              Active clients <span className="tabular font-semibold">{firm.counts.clients}</span>
            </p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Firm administrators</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {firm.admins.map((a) => (
                <AdminRow key={a.id} firmId={firm.id} admin={a} />
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      {editing && <EditFirmDialog firm={firm} open={editing} onOpenChange={setEditing} />}
    </>
  );
}
