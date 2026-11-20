import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, FileUp, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { valuationsApi } from '@/services/valuationsApi';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Skeleton, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlays';
import { EmptyState, ErrorState } from '@/components/data/States';
import { cleanInputs, EngineInputs } from '@/components/valuation/EngineInputs';
import { ValuationVersions } from '@/components/valuation/ValuationVersions';
import { humanize } from '@/utils/format';

/** Shared editor used for preliminary (junior) and final (senior) versions. */
export function VersionEditor({ caseId, stage, engine, initial, rendererAvailable, templates, onSaved }) {
  const qc = useQueryClient();
  const [inputs, setInputs] = useState(initial);
  const [summary, setSummary] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [templateId, setTemplateId] = useState('');
  const fileRef = useRef(null);
  useEffect(() => setInputs(initial), [initial]);
  const done = (res) => {
    qc.setQueryData(['valuations', caseId], res);
    qc.invalidateQueries({ queryKey: ['documents', caseId] });
    qc.invalidateQueries({ queryKey: ['cases', 'detail', caseId] });
    onSaved?.();
  };
  const save = useMutation({
    mutationFn: () => valuationsApi.createVersion(caseId, stage, { inputs: cleanInputs(inputs), ...(summary ? { summary } : {}), ...(changeNote ? { changeNote } : {}), ...(templateId ? { templateId } : {}) }),
    onSuccess: (res) => {
      done(res);
      toast.success('Version saved and report generated');
      setChangeNote('');
    },
    onError: (e) => toast.error(e.details?.join(' · ') ?? e.message),
  });
  const attach = useMutation({
    mutationFn: (file) => valuationsApi.attach(caseId, stage, file),
    onSuccess: (res) => (done(res), toast.success('PDF attached as a new version')),
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-5">
      <EngineInputs engine={engine} value={inputs} onChange={setInputs} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${stage}-summary`}>Valuer&apos;s summary / remarks (printed on the report)</Label>
          <Textarea id={`${stage}-summary`} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={5000} />
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${stage}-note`}>Change note (version history)</Label>
            <Input id={`${stage}-note`} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={1000} placeholder="e.g. Land rate corrected" />
          </div>
          {templates && (
            <div className="space-y-1.5">
              <Label htmlFor="final-template">Report format</Label>
              <select id="final-template" className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Automatic (best match for this lender & category)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          <Calculator /> Calculate & generate report
        </Button>
        <Button variant="outline" loading={attach.isPending} onClick={() => fileRef.current?.click()}>
          <FileUp /> Attach own PDF
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) attach.mutate(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </div>
      {!rendererAvailable && <p className="text-xs text-warning">Automatic PDF generation is not configured on this server; attach the report PDF after calculating.</p>}
    </div>
  );
}

export default function PreliminaryTab({ c }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['valuations', c.id], queryFn: () => valuationsApi.get(c.id) });
  const [confirm, setConfirm] = useState(false);
  const submit = useMutation({
    mutationFn: () => valuationsApi.submitPreliminary(c.id),
    onSuccess: (res) => {
      qc.setQueryData(['valuations', c.id], res);
      qc.invalidateQueries({ queryKey: ['cases', 'detail', c.id] });
      setConfirm(false);
      toast.success('Submitted to the senior reviewer');
    },
    onError: (e) => toast.error(e.message),
  });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-96" />;
  const p = data.preliminary;
  const latest = p?.versions[0];
  return (
    <div className="space-y-6">
      {data.permissions.canPrepare && (
        <Card>
          <CardHeader>
            <CardTitle>Prepare preliminary valuation</CardTitle>
            <CardDescription>Inputs are prefilled from the inspection. The server recomputes every figure and generates the PDF into 04_Preliminary_Valuation.</CardDescription>
          </CardHeader>
          <CardContent>
            <VersionEditor caseId={c.id} stage="preliminary" engine={data.engine} initial={latest?.inputs ?? data.defaults} rendererAvailable={data.rendererAvailable} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              Preliminary valuation {p && <Badge tone={p.status === 'APPROVED' ? 'success' : p.status === 'RETURNED' ? 'warning' : p.status === 'REJECTED' ? 'danger' : 'primary'}>{humanize(p.status)}</Badge>}
            </CardTitle>
            <CardDescription>{humanize(data.engine)} engine · immutable version history</CardDescription>
          </div>
          {data.permissions.canSubmit && (
            <Button onClick={() => setConfirm(true)}>
              <Send /> Submit to senior reviewer
            </Button>
          )}
        </CardHeader>
        <CardContent>{p?.versions.length ? <ValuationVersions report={p} /> : <EmptyState title="No preliminary valuation yet" description={c.status === 'INSPECTION_COMPLETED' ? 'The junior reviewer starts it from the Overview tab.' : undefined} />}</CardContent>
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit the preliminary valuation?"
        description={latest ? `Version ${latest.version} (market value ${latest.marketValue.toLocaleString('en-IN')}) goes to the senior technical reviewer.` : ''}
        confirmLabel="Submit"
        loading={submit.isPending}
        onConfirm={() => submit.mutate()}
      />
    </div>
  );
}
