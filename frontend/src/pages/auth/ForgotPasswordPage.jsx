import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { forgotPassword } from '@/services/authApi';
import { Button, Input } from '@/components/ui/primitives';
import { Field } from '@/components/forms/Field';
import { FormAlert } from '@/components/forms/FormAlert';
import { emailField } from '@/utils/validation';

const schema = z.object({ email: emailField });

export default function ForgotPasswordPage() {
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      setDone(await forgotPassword(email));
    } catch (e) {
      setError(e);
    }
  });

  if (done) {
    return (
      <>
        <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-success-soft text-success">
          <MailCheck className="size-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">{done.message} The link is valid for 30 minutes.</p>
        {done.devResetUrl && (
          <FormAlert tone="info" className="mt-4">
            <p className="mb-1 text-xs">Development only:</p>
            <a className="break-all text-xs underline" href={done.devResetUrl}>
              Open reset link
            </a>
          </FormAlert>
        )}
        <Button asChild variant="outline" className="mt-6 w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <Link to="/login" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter your email and we will send you a link to reset it.</p>
      <FormAlert error={error} className="mt-4" />
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!errors.email} {...form.register('email')} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Send reset link
        </Button>
      </form>
    </>
  );
}
