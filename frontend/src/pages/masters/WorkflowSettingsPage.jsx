import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { mastersApi } from '@/services/casesApi';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { ErrorState } from '@/components/data/States';
import { CASE_STATUS } from '@/utils/caseStatus';

const SLA_STATUSES = [
  'CASE_RECEIVED',
  'INSPECTION_ASSIGNED',
  'INSPECTION_IN_PROGRESS',
  'INSPECTION_COMPLETED',
  'PRELIMINARY_VALUATION_IN_PROGRESS',
  'PRELIMINARY_SUBMITTED',
  'FINAL_REVIEW_IN_PROGRESS',
  'SENT_BACK_FOR_CORRECTION',
  'FINAL_APPROVED',
];

/** Workflow configuration master: turnaround time per stage, auto-assignment and inspection rules. */
export default function WorkflowSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['masters', 'workflow'], queryFn: mastersApi.workflowSettings });
  const [sla, setSla] = useState({});
  const [options, setOptions] = useState(null);
  useEffect(() => {
    if (data) {
      setSla(data.slaHours);
      setOptions(data.options);
    }
  }, [data]);
  const save = useMutation({
    mutationFn: () => mastersApi.updateWorkflowSettings({ slaHours: Object.fromEntries(Object.entries(sla).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => [k, Number(v)])), options }),
    onSuccess: (res) => {
      qc.setQueryData(['masters', 'workflow'], res);
      toast.success('Workflow settings saved');
    },
    onError: (e) => toast.error(e.message),
  });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !options) return <Skeleton className="h-96" />;
  return (
    <>
      <PageHeader title="Workflow configuration" description="The stages and their order are fixed by the platform. These settings tune them for your firm." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Turnaround time (TAT)</CardTitle>
            <CardDescription>Hours a case may stay in a status before it is flagged overdue. Leave empty for no limit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {SLA_STATUSES.map((s) => (
              <div key={s} className="flex items-center gap-3">
                <Label htmlFor={`sla-${s}`} className="flex-1 font-normal">
                  {CASE_STATUS[s].label}
                </Label>
                <Input id={`sla-${s}`} type="number" min="0" className="w-28" value={sla[s] ?? ''} onChange={(e) => setSla({ ...sla, [s]: e.target.value })} placeholder="—" />
                <span className="w-10 text-xs text-muted-foreground">hours</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Assignment & inspection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="autoAssign">Reviewer assignment</Label>
              <NativeSelect id="autoAssign" value={options.autoAssign} onChange={(e) => setOptions({ ...options, autoAssign: e.target.value })}>
                <option value="MANUAL">Manual: chosen at hand-over, otherwise by the Firm Admin</option>
                <option value="LEAST_LOADED">Automatic: least-loaded reviewer</option>
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                The field officer picks the junior reviewer when submitting the inspection, and the junior picks the senior when submitting the preliminary valuation. Without a pick, automatic mode assigns the least-loaded reviewer. The junior reviewer of a case is never its senior reviewer.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minPhotos">Minimum inspection photographs</Label>
              <Input id="minPhotos" type="number" min="0" max="50" value={options.minInspectionPhotos} onChange={(e) => setOptions({ ...options, minInspectionPhotos: Number(e.target.value) })} />
            </div>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={options.requireSourceDocument} onChange={(e) => setOptions({ ...options, requireSourceDocument: e.target.checked })} />
              <span className="text-sm">Require at least one source document before a field officer can be assigned</span>
            </label>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save settings
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
