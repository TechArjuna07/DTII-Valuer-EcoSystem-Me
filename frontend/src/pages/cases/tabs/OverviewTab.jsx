import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { casesApi } from '@/services/casesApi';
import { Button, Card, CardContent, CardHeader, CardTitle, Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/overlays';
import { ACTION_LABEL, CASE_STATUS, STAGE_LABEL } from '@/utils/caseStatus';
import { cn } from '@/utils/cn';
import { formatDate, formatDateTime, formatINR } from '@/utils/format';

const STAGE_PERMISSION = { MARKETING: 'case.assign.field', FIELD: 'case.assign.field', JUNIOR: 'case.assign.reviewer', SENIOR: 'case.assign.reviewer' };

function AssignDialog({ caseId, stage, current, open, onOpenChange }) {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const { data } = useQuery({ queryKey: ['assignable', stage], queryFn: () => casesApi.assignable(stage), enabled: open });
  const m = useMutation({
    mutationFn: () => casesApi.assign(caseId, stage, employeeId),
    onSuccess: (c) => {
      qc.setQueryData(['cases', 'detail', caseId], c);
      qc.invalidateQueries({ queryKey: ['cases'] });
      toast.success(`${STAGE_LABEL[stage]} assigned`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`${current ? 'Reassign' : 'Assign'} ${STAGE_LABEL[stage].toLowerCase()}`} description="Only active employees with the matching role are listed, with their open workload.">
        <Label htmlFor="assign-employee">Employee</Label>
        <NativeSelect id="assign-employee" className="mt-1.5" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Select employee</option>
          {data?.items
            .filter((e) => e.id !== current?.id)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.employeeCode} · {e.openAssignments} open
              </option>
            ))}
        </NativeSelect>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!employeeId} loading={m.isPending} onClick={() => m.mutate()}>
            Assign
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionButtons({ c }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(null);
  const [remarks, setRemarks] = useState('');
  const m = useMutation({
    mutationFn: ({ action, remarks: r }) => casesApi.transition(c.id, action, r),
    onSuccess: (updated) => {
      qc.setQueryData(['cases', 'detail', c.id], updated);
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['timeline', c.id] });
      toast.success('Case updated');
      setPending(null);
      setRemarks('');
    },
    onError: (e) => toast.error(e.message),
  });
  const generic = c.allowedActions.filter((a) => a.generic);
  if (!generic.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {generic.map((a) => (
        <Button key={a.action} variant={['CANCEL', 'HOLD'].includes(a.action) ? 'outline' : 'default'} className={a.action === 'CANCEL' ? 'text-destructive' : ''} onClick={() => setPending(a)}>
          {ACTION_LABEL[a.action] ?? a.action}
        </Button>
      ))}
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={`${ACTION_LABEL[pending?.action] ?? ''}?`}
        description={pending?.remarksRequired ? 'A remark is required and is recorded on the case timeline.' : 'This is recorded on the case timeline.'}
        confirmLabel={ACTION_LABEL[pending?.action]}
        destructive={pending?.action === 'CANCEL'}
        loading={m.isPending}
        onConfirm={() => (pending.remarksRequired && remarks.trim().length < 3 ? toast.error('Enter a remark') : m.mutate({ action: pending.action, remarks: remarks.trim() || undefined }))}
      >
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="transition-remarks">Remarks{pending?.remarksRequired ? ' (required)' : ''}</Label>
          <Textarea id="transition-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} />
        </div>
      </ConfirmDialog>
    </div>
  );
}

/** Pipeline progress: completed / current / upcoming stages. */
function Pipeline({ c }) {
  const idx = c.pipeline.indexOf(c.status === 'CASE_ON_HOLD' ? c.holdFromStatus : c.status);
  return (
    <ol className="flex flex-wrap gap-1.5">
      {c.pipeline.map((s, i) => (
        <li
          key={s}
          className={cn(
            'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset',
            i < idx ? 'bg-success-soft text-success ring-success/20' : i === idx ? 'bg-primary text-white ring-primary' : 'bg-muted text-muted-foreground ring-border',
          )}
        >
          {i < idx && <Check className="size-3" />} {CASE_STATUS[s].label}
        </li>
      ))}
    </ol>
  );
}

export default function OverviewTab({ c, can, isClient }) {
  const [assigning, setAssigning] = useState(null);
  const rows = [
    ['Case ID', <span key="n" className="font-mono">{c.caseNumber}</span>],
    ['Repository', <span key="r" className="font-mono text-xs">{c.repositoryLabel}</span>],
    ['Loan type', c.loanType],
    ['Loan reference', c.loanReference],
    ['Loan amount', c.loanAmount ? formatINR(c.loanAmount) : null],
    ['Received on', formatDate(c.receivedOn)],
    ['Due date', c.dueDate ? formatDate(c.dueDate) : null],
    ['Status since', formatDateTime(c.statusChangedAt)],
    ['Property', [c.propertyAddress, c.propertyCity].filter(Boolean).join(', ') || null],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Pipeline c={c} />
          {c.status === 'CASE_ON_HOLD' && <p className="text-sm text-warning">On hold. It resumes at “{CASE_STATUS[c.holdFromStatus]?.label}”.</p>}
          {c.closureReason && <p className="rounded-lg bg-muted p-3 text-sm">Closure remark: {c.closureReason}</p>}
          {!isClient && <ActionButtons c={c} />}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 border-t pt-4 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm">{value || '—'}</dd>
              </div>
            ))}
          </dl>
          {c.description && <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{c.description}</p>}
        </CardContent>
      </Card>
      {!isClient && (
        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {['MARKETING', 'FIELD', 'JUNIOR', 'SENIOR'].map((stage) => {
              const a = c.assignments.find((x) => x.stage === stage);
              const canAssign = can(STAGE_PERMISSION[stage]) && !['CASE_COMPLETED', 'CASE_CANCELLED', 'CASE_REJECTED'].includes(c.status);
              return (
                <div key={stage} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{STAGE_LABEL[stage]}</p>
                    <p className="truncate text-sm font-medium">{a ? a.employee.name : <span className="text-muted-foreground">Not assigned</span>}</p>
                    {a && <p className="text-xs text-muted-foreground">since {formatDate(a.assignedAt)}</p>}
                  </div>
                  {canAssign && (
                    <Button size="sm" variant="outline" onClick={() => setAssigning({ stage, current: a?.employee })}>
                      <UserPlus /> {a ? 'Change' : 'Assign'}
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      {assigning && <AssignDialog caseId={c.id} stage={assigning.stage} current={assigning.current} open onOpenChange={(o) => !o && setAssigning(null)} />}
    </div>
  );
}
