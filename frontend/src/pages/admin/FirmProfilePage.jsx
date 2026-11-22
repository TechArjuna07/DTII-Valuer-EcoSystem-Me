import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAuth } from '@/context/AuthContext';
import { firmApi } from '@/services/adminApi';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { StatusBadge } from '@/components/data/StatusBadge';
import { ErrorState } from '@/components/data/States';
import { FormAlert } from '@/components/forms/FormAlert';
import { FirmFields, firmDefaults, firmFieldsSchema } from '@/components/forms/FirmFields';
import { ReportSettingsCard } from '@/components/forms/ReportSettingsCard';
import { formatDate } from '@/utils/format';
import { emptyToNull } from '@/utils/validation';

const schema = z.object(firmFieldsSchema);

export default function FirmProfilePage() {
  const { reload } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const { data: firm, isLoading, error: loadError, refetch } = useQuery({ queryKey: ['firm', 'profile'], queryFn: firmApi.profile });
  const form = useForm({ resolver: zodResolver(schema), values: firm ? firmDefaults(firm) : undefined });
  const { errors, isSubmitting, isDirty } = form.formState;

  if (loadError) return <ErrorState error={loadError} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-96 w-full" />;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await firmApi.updateProfile({ ...emptyToNull(v), name: v.name, email: v.email });
      toast.success('Firm profile saved');
      qc.invalidateQueries({ queryKey: ['firm'] });
      reload();
    } catch (e) {
      setError(e);
    }
  });

  return (
    <>
      <PageHeader title="Firm profile" description="Shown on emails and on valuation reports." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              <FormAlert error={error} />
              <FirmFields register={form.register} errors={errors} idPrefix="profile" />
              <div className="flex justify-end">
                <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                  Save profile
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Platform registration</CardTitle>
            <CardDescription>Managed by the platform administrator.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="flex items-center justify-between">
              Firm code <span className="font-mono font-semibold">{firm.firmCode}</span>
            </p>
            <p className="flex items-center justify-between">
              Status <StatusBadge status={firm.status} />
            </p>
            <p className="flex items-center justify-between">
              Plan <span>{firm.subscriptionPlan}</span>
            </p>
            <p className="flex items-center justify-between">
              Subscription <StatusBadge status={firm.subscriptionStatus} />
            </p>
            <p className="flex items-center justify-between">
              Valid till <span>{formatDate(firm.subscriptionValidTill)}</span>
            </p>
          </CardContent>
        </Card>
      </div>
      <ReportSettingsCard />
    </>
  );
}
