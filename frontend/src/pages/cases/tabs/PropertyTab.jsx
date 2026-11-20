import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { inspectionsApi } from '@/services/inspectionsApi';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { ErrorState } from '@/components/data/States';
import { DynamicCategoryForm } from '@/components/forms/DynamicCategoryForm';
import { formatDateTime } from '@/utils/format';

export default function PropertyTab({ c }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['property', c.id], queryFn: () => inspectionsApi.property(c.id) });
  const [values, setValues] = useState({});
  useEffect(() => data && setValues(data.data), [data]);
  const save = useMutation({
    mutationFn: () => inspectionsApi.saveProperty(c.id, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== null && v !== undefined))),
    onSuccess: (res) => {
      qc.setQueryData(['property', c.id], res);
      qc.invalidateQueries({ queryKey: ['inspection', c.id] });
      toast.success('Property details saved');
    },
    onError: (e) => toast.error(e.details?.join(' · ') ?? e.message),
  });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-80" />;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{data.category.name}: property details</CardTitle>
          <CardDescription>
            Fields come from the category master (v{data.fieldsVersion}).
            {data.updatedAt ? ` Last updated ${formatDateTime(data.updatedAt)}.` : ''}
            {data.missingRequired.length > 0 && <span className="text-warning"> Missing: {data.missingRequired.join(', ')}.</span>}
          </CardDescription>
        </div>
        {data.canEdit && (
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save details
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DynamicCategoryForm fields={data.fields} values={values} onChange={setValues} readOnly={!data.canEdit} />
      </CardContent>
    </Card>
  );
}
