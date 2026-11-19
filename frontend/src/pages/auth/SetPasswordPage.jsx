import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, LinkIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { acceptInvite, resetPassword, tokenInfo } from '@/services/authApi';
import { Button, Spinner } from '@/components/ui/primitives';
import { Field } from '@/components/forms/Field';
import { FormAlert } from '@/components/forms/FormAlert';
import { PasswordInput } from '@/components/forms/PasswordInput';
import { passwordPolicy } from '@/utils/validation';

const schema = z
  .object({ password: passwordPolicy, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

/** Handles both invitation acceptance (mode="invite") and password reset (mode="reset") links. */
export default function SetPasswordPage({ mode }) {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const purpose = mode === 'invite' ? 'INVITE' : 'PASSWORD_RESET';
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const info = useQuery({ queryKey: ['token-info', purpose, token], queryFn: () => tokenInfo(token, purpose), enabled: token.length >= 20, retry: false });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await (mode === 'invite' ? acceptInvite(token, password) : resetPassword(token, password));
      setDone(true);
    } catch (e) {
      setError(e);
    }
  });

  if (done) {
    return (
      <>
        <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-success-soft text-success">
          <CheckCircle2 className="size-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{mode === 'invite' ? 'Your account is ready' : 'Password updated'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">You can now sign in with your new password.</p>
        <Button asChild className="mt-6 w-full" size="lg">
          <Link to="/login">Sign in</Link>
        </Button>
      </>
    );
  }

  if (token.length < 20 || info.isError) {
    return (
      <>
        <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-destructive-soft text-destructive">
          <LinkIcon className="size-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Link invalid or expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === 'invite' ? 'Ask your firm administrator to resend your invitation.' : 'Request a new password reset link.'}
        </p>
        <Button asChild variant="outline" className="mt-6 w-full">
          <Link to={mode === 'invite' ? '/login' : '/forgot-password'}>{mode === 'invite' ? 'Back to sign in' : 'Request a new link'}</Link>
        </Button>
      </>
    );
  }

  if (info.isLoading) return <Spinner className="mx-auto size-7" />;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{mode === 'invite' ? 'Set up your account' : 'Choose a new password'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {info.data.fullName} · {info.data.email}
      </p>
      <FormAlert error={error} className="mt-4" />
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <Field label="New password" htmlFor="password" error={errors.password?.message} hint="At least 10 characters with upper and lower case letters and a digit or symbol.">
          <PasswordInput id="password" autoComplete="new-password" autoFocus aria-invalid={!!errors.password} {...form.register('password')} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
          <PasswordInput id="confirm" autoComplete="new-password" aria-invalid={!!errors.confirm} {...form.register('confirm')} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          {mode === 'invite' ? 'Activate account' : 'Update password'}
        </Button>
      </form>
    </>
  );
}
