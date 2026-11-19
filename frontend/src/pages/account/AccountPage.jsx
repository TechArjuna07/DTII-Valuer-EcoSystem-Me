import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, LogOut, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAuth } from '@/context/AuthContext';
import { changePassword, listSessions, revokeSession } from '@/services/authApi';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlays';
import { PageHeader } from '@/components/data/PageHeader';
import { ErrorState } from '@/components/data/States';
import { Field } from '@/components/forms/Field';
import { FormAlert } from '@/components/forms/FormAlert';
import { PasswordInput } from '@/components/forms/PasswordInput';
import { formatDateTime } from '@/utils/format';
import { passwordPolicy } from '@/utils/validation';

const pwSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordPolicy, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

/** Rough, display-only device label from the user agent. */
function deviceLabel(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return { text: `${browser} on ${os}`, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

function ChangePasswordCard() {
  const [error, setError] = useState(null);
  const form = useForm({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;
  const qc = useQueryClient();
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const res = await changePassword(v.currentPassword, v.newPassword);
      toast.success(res.message);
      form.reset();
      qc.invalidateQueries({ queryKey: ['sessions'] });
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>Other devices will be signed out. This device stays signed in.</CardDescription>
      </CardHeader>
      <CardContent>
        <FormAlert error={error} className="mb-4" />
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="Current password" htmlFor="currentPassword" error={errors.currentPassword?.message}>
            <PasswordInput id="currentPassword" autoComplete="current-password" {...form.register('currentPassword')} />
          </Field>
          <Field label="New password" htmlFor="newPassword" error={errors.newPassword?.message} hint="At least 10 characters, upper and lower case, and a digit or symbol.">
            <PasswordInput id="newPassword" autoComplete="new-password" {...form.register('newPassword')} />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm" error={errors.confirm?.message}>
            <PasswordInput id="confirm" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" loading={isSubmitting}>
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const { logout } = useAuth();
  const qc = useQueryClient();
  const [target, setTarget] = useState(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['sessions'], queryFn: listSessions });
  const revoke = useMutation({
    mutationFn: (s) => revokeSession(s.id),
    onSuccess: (_d, s) => {
      setTarget(null);
      if (s.current) return logout();
      toast.success('Device signed out');
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed-in devices</CardTitle>
        <CardDescription>Sign out any device you do not recognise, then change your password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-16 w-full" />}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {data?.items.map((s) => {
          const d = deviceLabel(s.userAgent ?? '');
          const Icon = d.mobile ? Smartphone : Laptop;
          return (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
              <Icon className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {d.text} {s.current && <Badge tone="primary">This device</Badge>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.ip ?? 'Unknown IP'} · signed in {formatDateTime(s.signedInAt)} · last active {formatDateTime(s.lastActiveAt)}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setTarget(s)} aria-label="Sign out device">
                <LogOut /> Sign out
              </Button>
            </div>
          );
        })}
      </CardContent>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Sign out this device?"
        description={target?.current ? 'You will be signed out of this browser now.' : 'That device will need to sign in again.'}
        confirmLabel="Sign out"
        destructive
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate(target)}
      />
    </Card>
  );
}

export default function AccountPage() {
  const { me } = useAuth();
  return (
    <>
      <PageHeader title="My account" description="Your profile, password and signed-in devices." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Contact your firm administrator to change these details.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</dt>
                <dd className="mt-1">{me.user.fullName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
                <dd className="mt-1 break-all">{me.user.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{me.context.type === 'PLATFORM' ? 'Context' : 'Firm'}</dt>
                <dd className="mt-1">{me.context.firm ? `${me.context.firm.name} (${me.context.firm.firmCode})` : 'Platform administration'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Roles</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {me.context.roles.map((r) => (
                    <Badge key={r.code} tone="primary">
                      {r.name}
                    </Badge>
                  ))}
                </dd>
              </div>
              {me.employee && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Employee code</dt>
                  <dd className="mt-1 font-mono">{me.employee.employeeCode}</dd>
                </div>
              )}
              {me.client && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Client code</dt>
                  <dd className="mt-1 font-mono">{me.client.clientCode}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
        <ChangePasswordCard />
        <div className="lg:col-span-2">
          <SessionsCard />
        </div>
      </div>
    </>
  );
}
