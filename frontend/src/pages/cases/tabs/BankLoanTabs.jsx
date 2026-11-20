import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, Download, Landmark, Paperclip, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/services/apiClient';
import { casesApi } from '@/services/casesApi';
import { openDocument } from '@/services/documentsApi';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton, Textarea } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/data/States';
import { StatCard } from '@/components/data/StatCard';
import { formatDate, formatINR, todayIst } from '@/utils/format';

const bankApi = {
  get: (id) => api.get(`/cases/${id}/bank`),
  post: (id, path, fields, file) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== '' && v !== undefined && v !== null) fd.append(k, String(v));
    if (file) fd.append('file', file);
    return api.upload(`/cases/${id}/bank/${path}`, fd);
  },
};

function useBank(c) {
  return useQuery({ queryKey: ['bank', c.id], queryFn: () => bankApi.get(c.id) });
}

function useBankAction(c) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, fields, file }) => bankApi.post(c.id, path, fields, file),
    onSuccess: (res, v) => {
      qc.setQueryData(['bank', c.id], res);
      qc.invalidateQueries({ queryKey: ['cases', 'detail', c.id] });
      qc.invalidateQueries({ queryKey: ['documents', c.id] });
      toast.success(res.caseStatus === 'CASE_COMPLETED' && v.path === 'disbursements' ? 'Loan fully disbursed: case completed' : v.msg);
    },
    onError: (e) => toast.error(e.details?.join(' · ') ?? e.message),
  });
}

function FilePick({ file, setFile, label = 'Attach document' }) {
  const ref = useRef(null);
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()}>
        <Paperclip /> {file ? 'Change file' : label}
      </Button>
      {file && <span className="truncate text-xs text-muted-foreground">{file.name}</span>}
      <input ref={ref} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
    </div>
  );
}

/** Bank submission tab: download the signed file, record digital / physical submission and acknowledgement. */
export function BankSubmissionTab({ c }) {
  const { data, isLoading, error, refetch } = useBank(c);
  const act = useBankAction(c);
  const [v, setV] = useState({ mode: 'DIGITAL', submittedOn: todayIst(), submittedTo: '', ackNumber: '', remarks: '' });
  const [file, setFile] = useState(null);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="size-4" /> {data.lender.name}
            {data.lender.branch ? `, ${data.lender.branch}` : ''}
          </CardTitle>
          <CardDescription>{data.lender.requiresClientApproval ? 'This lender receives the client-signed report.' : 'This lender receives the valuer-signed report (no client approval step).'}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.deliverable ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <CheckCircle2 className="size-5 text-success" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{data.deliverable.fileName}</p>
                <p className="break-all font-mono text-[10px] text-muted-foreground">SHA-256 {data.deliverable.sha256}</p>
              </div>
              <Button size="sm" onClick={() => openDocument(data.deliverable.documentId, { versionId: data.deliverable.versionId }).catch((e) => toast.error(e.message))}>
                <Download /> Download signed report
              </Button>
            </div>
          ) : (
            <EmptyState title="The signed report is not ready yet" />
          )}
        </CardContent>
      </Card>
      {data.permissions.canSubmit && (
        <Card>
          <CardHeader>
            <CardTitle>Record submission</CardTitle>
            <CardDescription>Enter the acknowledgement number and / or attach the bank acknowledgement (filed in 08_Bank_Submission).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="sub-mode">Mode</Label>
              <NativeSelect id="sub-mode" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
                <option value="DIGITAL">Digital</option>
                <option value="PHYSICAL">Physical</option>
                <option value="BOTH">Digital + physical</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-date">Submitted on</Label>
              <Input id="sub-date" type="date" max={todayIst()} value={v.submittedOn} onChange={(e) => setV({ ...v, submittedOn: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-to">Submitted to</Label>
              <Input id="sub-to" value={v.submittedTo} onChange={(e) => setV({ ...v, submittedTo: e.target.value })} placeholder="Officer / desk" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-ack">Acknowledgement no.</Label>
              <Input id="sub-ack" value={v.ackNumber} onChange={(e) => setV({ ...v, ackNumber: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="sub-remarks">Remarks</Label>
              <Textarea id="sub-remarks" value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
              <FilePick file={file} setFile={setFile} label="Attach acknowledgement" />
              <Button
                disabled={!v.ackNumber && !file}
                loading={act.isPending}
                onClick={() => act.mutate({ path: 'submissions', fields: v, file, msg: 'Submission recorded' }, { onSuccess: () => (setFile(null), setV({ ...v, ackNumber: '', remarks: '' })) })}
              >
                <Send /> Record submission
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Submission history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.submissions.length ? (
            data.submissions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                <Badge tone="primary">{s.mode.toLowerCase()}</Badge>
                <span>{formatDate(s.submittedOn)}</span>
                {s.submittedTo && <span className="text-muted-foreground">to {s.submittedTo}</span>}
                {s.ackNumber && <span className="font-mono text-xs">ACK {s.ackNumber}</span>}
                {s.ackDocumentId && (
                  <Button size="sm" variant="link" onClick={() => openDocument(s.ackDocumentId).catch((e) => toast.error(e.message))}>
                    acknowledgement
                  </Button>
                )}
                {s.remarks && <span className="basis-full text-xs text-muted-foreground">{s.remarks}</span>}
              </div>
            ))
          ) : (
            <EmptyState title="Not submitted yet" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Sanction & disbursement tab: lender decision, tranches (never beyond the sanction), and case closure. */
export function SanctionDisbursementTab({ c }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useBank(c);
  const act = useBankAction(c);
  const [s, setS] = useState({ outcome: 'SANCTIONED', amount: '', sanctionDate: todayIst(), referenceNo: '', remarks: '' });
  const [d, setD] = useState({ amount: '', disbursedOn: todayIst(), referenceNo: '', isFinal: false, remarks: '' });
  const [sFile, setSFile] = useState(null);
  const [dFile, setDFile] = useState(null);
  const close = useMutation({
    mutationFn: () => casesApi.transition(c.id, 'CLOSE_CASE', 'Loan disbursed; case closed'),
    onSuccess: (updated) => {
      qc.setQueryData(['cases', 'detail', c.id], updated);
      qc.invalidateQueries({ queryKey: ['bank', c.id] });
      toast.success('Case completed');
    },
    onError: (e) => toast.error(e.message),
  });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-64" />;
  const p = data.permissions;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Sanctioned" value={formatINR(data.totals.sanctioned)} icon={<CheckCircle2 />} hint={data.sanction ? `${data.sanction.outcome.toLowerCase()} on ${formatDate(data.sanction.sanctionDate)}` : 'Awaiting lender decision'} />
        <StatCard label="Disbursed" value={formatINR(data.totals.disbursed)} icon={<Banknote />} hint={`${data.disbursements.length} tranche(s)`} />
        <StatCard label="Remaining" value={formatINR(data.totals.remaining)} icon={<Banknote />} />
      </div>
      {p.canRecordSanction && (
        <Card>
          <CardHeader>
            <CardTitle>Record lender decision</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="s-outcome">Decision</Label>
              <NativeSelect id="s-outcome" value={s.outcome} onChange={(e) => setS({ ...s, outcome: e.target.value })}>
                <option value="SANCTIONED">Sanctioned</option>
                <option value="DECLINED">Declined</option>
              </NativeSelect>
            </div>
            {s.outcome === 'SANCTIONED' && (
              <div className="space-y-1.5">
                <Label htmlFor="s-amount">Sanctioned amount (₹)</Label>
                <Input id="s-amount" type="number" min="1" value={s.amount} onChange={(e) => setS({ ...s, amount: e.target.value })} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="s-date">Date</Label>
              <Input id="s-date" type="date" max={todayIst()} value={s.sanctionDate} onChange={(e) => setS({ ...s, sanctionDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-ref">Reference no.</Label>
              <Input id="s-ref" value={s.referenceNo} onChange={(e) => setS({ ...s, referenceNo: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="s-remarks">{s.outcome === 'DECLINED' ? 'Reason given by the lender (required)' : 'Remarks'}</Label>
              <Textarea id="s-remarks" value={s.remarks} onChange={(e) => setS({ ...s, remarks: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
              <FilePick file={sFile} setFile={setSFile} label={s.outcome === 'DECLINED' ? 'Attach decline letter' : 'Attach sanction letter'} />
              <Button loading={act.isPending} onClick={() => act.mutate({ path: 'sanction', fields: { ...s, amount: s.outcome === 'SANCTIONED' ? s.amount : '' }, file: sFile, msg: 'Lender decision recorded' })}>
                Save decision
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {p.canRecordDisbursement && (
        <Card>
          <CardHeader>
            <CardTitle>Record disbursement</CardTitle>
            <CardDescription>Remaining {formatINR(data.totals.remaining)}. Mark the last tranche as final to complete disbursement.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="d-amount">Amount (₹)</Label>
              <Input id="d-amount" type="number" min="1" max={data.totals.remaining} value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-date">Disbursed on</Label>
              <Input id="d-date" type="date" max={todayIst()} value={d.disbursedOn} onChange={(e) => setD({ ...d, disbursedOn: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-ref">UTR / reference</Label>
              <Input id="d-ref" value={d.referenceNo} onChange={(e) => setD({ ...d, referenceNo: e.target.value })} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={d.isFinal} onChange={(e) => setD({ ...d, isFinal: e.target.checked })} /> Final tranche (automatic when the full sanctioned amount is disbursed; the case is then completed)
            </label>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
              <FilePick file={dFile} setFile={setDFile} label="Attach confirmation" />
              <Button
                disabled={!(Number(d.amount) > 0)}
                loading={act.isPending}
                onClick={() => act.mutate({ path: 'disbursements', fields: d, file: dFile, msg: 'Disbursement recorded' }, { onSuccess: () => (setDFile(null), setD({ ...d, amount: '', referenceNo: '' })) })}
              >
                Record tranche
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Disbursements</CardTitle>
          {p.canClose && (
            <Button loading={close.isPending} onClick={() => close.mutate()}>
              <CheckCircle2 /> Close case
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {data.sanction?.outcome === 'DECLINED' && <p className="rounded-lg bg-destructive-soft p-3 text-sm text-destructive">Declined by the lender: {data.sanction.remarks}</p>}
          {data.disbursements.length ? (
            data.disbursements.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                <span className="font-semibold">#{x.trancheNo}</span>
                <span className="tabular">{formatINR(x.amount)}</span>
                <span>{formatDate(x.disbursedOn)}</span>
                {x.referenceNo && <span className="font-mono text-xs">{x.referenceNo}</span>}
                {x.isFinal && <Badge tone="success">final</Badge>}
              </div>
            ))
          ) : (
            <EmptyState title="No disbursements yet" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
