import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, FileSignature, IndianRupee, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { approvalsApi } from '@/services/approvalsApi';
import { openDocument } from '@/services/documentsApi';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import { EmptyState, ErrorState } from '@/components/data/States';
import { PasswordInput } from '@/components/forms/PasswordInput';
import { ValuesSummary } from '@/components/valuation/ValuationVersions';
import { formatDate, formatDateTime, formatINR, humanize } from '@/utils/format';

/** Signing dialog: shows the declaration, requires explicit consent and the user's password (step-up). */
function SignDialog({ title, consentText, legallyValid, onSign, onClose, pending }) {
  const [agree, setAgree] = useState(false);
  const [password, setPassword] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description="Your signature is recorded with the date, time, IP address and a fingerprint of the document.">
        <div className="space-y-4">
          {!legallyValid && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" /> Sandbox signer (testing): this is not a legally valid digital signature. Production uses a certificate-based provider.
            </p>
          )}
          <p className="rounded-lg bg-muted p-3 text-sm">{consentText}</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I have read the report and agree to the declaration above.
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="sign-password">Confirm your password</Label>
            <PasswordInput id="sign-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!agree || !password} loading={pending} onClick={() => onSign(password)}>
              <FileSignature /> Sign
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignatureList({ signatures, canVerify }) {
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: (id) => approvalsApi.verify(id),
    onSuccess: (r) => (r.ok ? toast.success('Signature verified: files intact') : toast.error('Verification FAILED: the signed files do not match')),
    onError: (e) => toast.error(e.message),
  });
  const refresh = useMutation({ mutationFn: (id) => approvalsApi.refresh(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['approval'] }), onError: (e) => toast.error(e.message) });
  if (!signatures.length) return <p className="text-sm text-muted-foreground">No signatures yet.</p>;
  return (
    <ul className="space-y-2">
      {signatures.map((s) => (
        <li key={s.id} className="rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {s.status === 'SIGNED' ? <ShieldCheck className="size-4 text-success" /> : <RefreshCw className="size-4 text-warning" />}
            <span className="font-medium">{s.signerName}</span>
            <Badge>{humanize(s.signerRole)}</Badge>
            <Badge tone={s.status === 'SIGNED' ? 'success' : s.status === 'PENDING' ? 'warning' : 'danger'}>{s.status.toLowerCase()}</Badge>
            <Badge tone={s.legallyValid ? 'success' : 'warning'}>{s.legallyValid ? humanize(s.provider) : 'sandbox'}</Badge>
            <span className="text-xs text-muted-foreground">{s.signedAt ? formatDateTime(s.signedAt) : `requested ${formatDateTime(s.requestedAt)}`}</span>
          </div>
          {s.certSubject && (
            <p className="mt-1 text-xs text-muted-foreground">
              {s.certSubject} · issuer {s.certIssuer ?? '—'} · {s.signatureAlgorithm}
            </p>
          )}
          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Document SHA-256 {s.documentSha256}</p>
          {s.lastError && <p className="mt-1 text-xs text-destructive">{s.lastError}</p>}
          <div className="mt-2 flex gap-2">
            {canVerify && s.status === 'SIGNED' && (
              <Button size="sm" variant="outline" loading={verify.isPending && verify.variables === s.id} onClick={() => verify.mutate(s.id)}>
                Verify now
              </Button>
            )}
            {s.status === 'PENDING' && (
              <Button size="sm" variant="outline" loading={refresh.isPending} onClick={() => refresh.mutate(s.id)}>
                <RefreshCw /> Check status
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

const MODES = [
  ['UPI', 'UPI'],
  ['BANK_TRANSFER', 'Bank transfer (NEFT / RTGS / IMPS)'],
  ['CHEQUE', 'Cheque'],
  ['CASH', 'Cash'],
  ['CARD', 'Card'],
  ['OTHER', 'Other'],
];
const today = () => new Date().toISOString().slice(0, 10);

/** "Payment received" — one confirmation, pre-filled with the invoice amount. A payment gateway will use the same record later. */
function PaymentDialog({ expected, pending, onClose, onSave }) {
  const [v, setV] = useState({ amount: expected ?? '', receivedOn: today(), mode: 'UPI', reference: '', remarks: '' });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Payment received" description="Recording the payment completes the case and releases the signed report to the client.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount received (₹)</Label>
            <Input id="pay-amount" type="number" min="1" step="any" value={v.amount} onChange={set('amount')} />
            {expected != null && <p className="text-xs text-muted-foreground">Invoice total incl. GST: {formatINR(expected)}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-date">Received on</Label>
            <Input id="pay-date" type="date" max={today()} value={v.receivedOn} onChange={set('receivedOn')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-mode">Mode</Label>
            <NativeSelect id="pay-mode" value={v.mode} onChange={set('mode')}>
              {MODES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Reference (UTR / cheque no.)</Label>
            <Input id="pay-ref" maxLength={120} value={v.reference} onChange={set('reference')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pay-remarks">Remarks (optional)</Label>
            <Input id="pay-remarks" maxLength={1000} value={v.remarks} onChange={set('remarks')} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!(Number(v.amount) > 0) || !v.receivedOn}
            loading={pending}
            onClick={() => onSave({ amount: Number(v.amount), receivedOn: v.receivedOn, mode: v.mode, ...(v.reference.trim() ? { reference: v.reference.trim() } : {}), ...(v.remarks.trim() ? { remarks: v.remarks.trim() } : {}) })}
          >
            <CheckCircle2 /> Confirm payment received
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaymentCard({ c, data, onRecord }) {
  const pay = data.payment;
  const paid = pay.payments.length > 0;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            Payment {paid ? <Badge tone="success">received</Badge> : c.status === 'PAYMENT_PENDING' ? <Badge tone="warning">pending</Badge> : <Badge>after signature</Badge>}
          </CardTitle>
          <CardDescription>
            {paid ? 'The fee is received and the case is complete.' : c.status === 'PAYMENT_PENDING' ? 'The report is signed. The case stays open until the fee is received.' : 'Payment is recorded once the final report is signed.'}
            {pay.expectedAmount != null && !paid && ` Invoice total ${formatINR(pay.expectedAmount)} (incl. GST).`}
          </CardDescription>
        </div>
        {data.permissions.canRecordPayment && (
          <Button onClick={onRecord}>
            <IndianRupee /> Payment received
          </Button>
        )}
      </CardHeader>
      {paid && (
        <CardContent className="space-y-2">
          {pay.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
              <span className="font-semibold tabular-nums">{formatINR(p.amount)}</span>
              <span>{formatDate(p.receivedOn)}</span>
              <Badge>{humanize(p.mode)}</Badge>
              {p.reference && <span className="text-muted-foreground">Ref. {p.reference}</span>}
              {p.source === 'GATEWAY' && <Badge tone="primary">gateway</Badge>}
              {p.remarks && <span className="basis-full text-xs text-muted-foreground">{p.remarks}</span>}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

/** "Final report & payment" tab: the senior signs, staff record the payment (which completes the case), the client downloads it. */
export default function ApprovalTab({ c, isClient }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['approval', c.id], queryFn: () => approvalsApi.get(c.id) });
  const [signing, setSigning] = useState(false);
  const [paying, setPaying] = useState(false);
  const pay = useMutation({
    mutationFn: (body) => approvalsApi.recordPayment(c.id, body),
    onSuccess: (res) => {
      qc.setQueryData(['approval', c.id], res);
      qc.invalidateQueries({ queryKey: ['cases', 'detail', c.id] });
      qc.invalidateQueries({ queryKey: ['documents', c.id] });
      setPaying(false);
      toast.success('Payment recorded. The case is complete and the client can download the report.');
    },
    onError: (e) => toast.error(e.details?.join(' · ') ?? e.message),
  });
  const sign = useMutation({
    mutationFn: (password) => approvalsApi.signValuer(c.id, password),
    onSuccess: (res) => {
      qc.setQueryData(['approval', c.id], res);
      qc.invalidateQueries({ queryKey: ['cases', 'detail', c.id] });
      qc.invalidateQueries({ queryKey: ['documents', c.id] });
      setSigning(false);
      toast.success(res.caseStatus === 'PAYMENT_PENDING' ? 'Report signed. Record the payment when the fee is received to complete the case.' : 'Signature request sent to the signing app');
    },
    onError: (e) => toast.error(e.message),
  });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-80" />;
  const f = data.finalReport;
  const p = data.permissions;

  if (isClient && !data.released) return <EmptyState title="Your valuation report is being prepared" description="You will be notified when the signed report is ready to download." />;
  if (!f) return <EmptyState title="No final report yet" description="The senior reviewer issues the final report after reviewing the preliminary valuation." />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Final valuation report v{f.version}</CardTitle>
            <CardDescription>{f.valuerSigned ? 'Digitally signed by the valuer.' : 'Awaiting the valuer’s digital signature.'}</CardDescription>
          </div>
          {f.documentId && (
            <Button variant="outline" onClick={() => openDocument(f.documentId, { disposition: 'inline' }).catch((e) => toast.error(e.message))}>
              <Eye /> {f.valuerSigned ? 'View signed report' : 'View report'}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <ValuesSummary v={f} />
          <p className="break-all font-mono text-[10px] text-muted-foreground">Report file SHA-256 {f.documentSha256}</p>
          {!isClient && p.canValuerSign && (
            <Button onClick={() => setSigning(true)}>
              <FileSignature /> Sign final report
            </Button>
          )}
        </CardContent>
      </Card>
      {!isClient && data.payment && <PaymentCard c={c} data={data} onRecord={() => setPaying(true)} />}
      <Card>
        <CardHeader>
          <CardTitle>Signature</CardTitle>
          <CardDescription>
            Provider: {humanize(data.provider.name)} {data.provider.legallyValid ? '(certificate-based)' : '(sandbox — testing only, until the DSC integration)'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignatureList signatures={data.signatures} canVerify={!isClient} />
        </CardContent>
      </Card>
      {paying && <PaymentDialog expected={data.payment?.expectedAmount} pending={pay.isPending} onClose={() => setPaying(false)} onSave={(body) => pay.mutate(body)} />}
      {signing && (
        <SignDialog
          title="Sign the final report as valuer"
          consentText={data.consentText}
          legallyValid={data.provider.legallyValid}
          pending={sign.isPending}
          onClose={() => setSigning(false)}
          onSign={(password) => sign.mutate(password)}
        />
      )}
    </div>
  );
}
