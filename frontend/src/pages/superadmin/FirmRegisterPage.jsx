import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { platformApi } from '@/services/adminApi';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { InviteNotice } from '@/components/data/InviteNotice';
import { Field } from '@/components/forms/Field';
import { FormAlert } from '@/components/forms/FormAlert';
import { FirmFields, firmDefaults, firmFieldsSchema } from '@/components/forms/FirmFields';
import { compact, emailField, optionalText, phoneField } from '@/utils/validation';

const schema = z.object({
  ...firmFieldsSchema,
  admin: z.object({
    fullName: z.string().trim().min(2, 'Admin name is required').max(150),
    email: emailField,
    phone: optionalText(20, phoneField),
    designation: optionalText(100),
  }),
});

export default function FirmRegisterPage() {
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { ...firmDefaults(), admin: { fullName: '', email: '', phone: '', designation: '' } } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ admin, ...firm }) => {
    setError(null);
    try {
      const res = await platformApi.registerFirm({ ...compact(firm), admin: compact(admin) });
      setResult(res);
      qc.invalidateQueries({ queryKey: ['platform'] });
    } catch (e) {
      setError(e);
    }
  });

  if (result) {
    return (
      <>
        <PageHeader title="Firm registered" crumbs={[{ label: 'Firms', href: '/platform/firms' }, { label: 'Register' }]} />
        <Card className="max-w-2xl">
          <CardContent className="space-y-4 pt-5">
            <p className="flex items-center gap-2 text-base font-semibold">
              <CheckCircle2 className="size-5 text-success" /> {result.firm.name}
            </p>
            <p className="text-sm text-muted-foreground">
              Firm code <span className="font-mono font-medium text-foreground">{result.firm.firmCode}</span> has been assigned permanently. It appears in every Case ID of this firm.
            </p>
            <p className="text-sm">
              Firm Admin: <span className="font-medium">{result.admin.fullName}</span> ({result.admin.email})
            </p>
            <InviteNotice invite={result.invite} />
            <div className="flex gap-2">
              <Button asChild>
                <Link to={`/platform/firms/${result.firm.id}`}>Open firm</Link>
              </Button>
              <Button variant="outline" onClick={() => (setResult(null), form.reset())}>
                Register another
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Register valuation firm" description="Creates the firm, assigns its permanent firm code and invites its first Firm Admin." crumbs={[{ label: 'Firms', href: '/platform/firms' }, { label: 'Register' }]} />
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <FormAlert error={error} />
        <Card>
          <CardHeader>
            <CardTitle>Firm details</CardTitle>
          </CardHeader>
          <CardContent>
            <FirmFields register={form.register} errors={errors} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Firm Admin</CardTitle>
            <CardDescription>This person receives an email to set their password. They then register the firm&apos;s employees and clients.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="admin-fullName" error={errors.admin?.fullName?.message} required>
              <Input id="admin-fullName" aria-invalid={!!errors.admin?.fullName} {...form.register('admin.fullName')} />
            </Field>
            <Field label="Email (login)" htmlFor="admin-email" error={errors.admin?.email?.message} required>
              <Input id="admin-email" type="email" aria-invalid={!!errors.admin?.email} {...form.register('admin.email')} />
            </Field>
            <Field label="Phone" htmlFor="admin-phone" error={errors.admin?.phone?.message}>
              <Input id="admin-phone" type="tel" {...form.register('admin.phone')} />
            </Field>
            <Field label="Designation" htmlFor="admin-designation" error={errors.admin?.designation?.message}>
              <Input id="admin-designation" placeholder="Firm Administrator" {...form.register('admin.designation')} />
            </Field>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-2">
          <Button asChild variant="outline">
            <Link to="/platform/firms">Cancel</Link>
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Register firm
          </Button>
        </div>
      </form>
    </>
  );
}
