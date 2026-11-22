import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { firmApi } from '@/services/adminApi';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Skeleton, Textarea } from '@/components/ui/primitives';

const LETTERHEAD = [
  ['title', 'Letterhead name', 'e.g. AMOL D. GOTMARE (defaults to the firm name)'],
  ['qualifications', 'Qualifications', 'B.E. (Civil), M.Sc (R.E.V), M.I.E., F.I.V.'],
  ['subtitle', 'Sub-title', 'Engineers & Valuation Consultants'],
  ['designations', 'Designations', 'Consulting Civil Engg. * Govt. Regd. Valuer (CAT-I) * Approved Valuer * Chartered Engineer'],
  ['pan', 'PAN', 'AAAAA9999A'],
  ['sacCode', 'SAC code', '997224'],
];
const BILLING = [
  ['invoicePrefix', 'Invoice no. prefix', 'e.g. MUM/JM → MUM/JM/26-27/<case no.>'],
  ['gstRatePct', 'GST rate % (CGST + SGST)', '18'],
  ['accountHolder', 'Account holder name', ''],
  ['accountNumber', 'Account number', ''],
  ['ifsc', 'IFSC', ''],
  ['bankBranch', 'Bank & branch', 'State Bank of India, Chakala Road, Andheri East, Mumbai 400059'],
  ['upiId', 'UPI ID (QR on the invoice)', 'name@bank'],
];

/** Letterhead and billing details printed on bank-format (SBI / IBA) flat reports and their proforma invoice. */
export function ReportSettingsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['firm', 'report-settings'], queryFn: firmApi.reportSettings });
  const [v, setV] = useState(null);
  useEffect(() => data && setV(data), [data]);
  const save = useMutation({
    mutationFn: () =>
      firmApi.updateReportSettings({
        letterhead: Object.fromEntries(Object.entries(v.letterhead).filter(([, x]) => x !== '' && x != null)),
        billing: Object.fromEntries(Object.entries(v.billing).filter(([, x]) => x !== '' && x != null).map(([k, x]) => [k, k === 'gstRatePct' ? Number(x) : x])),
      }),
    onSuccess: (res) => {
      qc.setQueryData(['firm', 'report-settings'], res);
      toast.success('Report settings saved');
    },
    onError: (e) => toast.error(e.details?.join(' · ') ?? e.message),
  });
  if (isLoading || !v) return <Skeleton className="h-64" />;
  const field = (group, [key, label, placeholder]) => (
    <div key={key} className="space-y-1.5">
      <Label htmlFor={`rs-${key}`}>{label}</Label>
      <Input id={`rs-${key}`} value={v[group][key] ?? ''} placeholder={placeholder} onChange={(e) => setV({ ...v, [group]: { ...v[group], [key]: e.target.value } })} />
    </div>
  );
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Bank report letterhead & billing</CardTitle>
        <CardDescription>Printed on bank-format (SBI / IBA) flat valuation reports. Firm name, address, GSTIN, phone and e-mail come from the profile above. The proforma invoice page is added when a fee is entered on the final report.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">{LETTERHEAD.map((f) => field('letterhead', f))}</div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-empanelment">Empanelment / licence line</Label>
          <Textarea id="rs-empanelment" rows={2} value={v.letterhead.empanelment ?? ''} placeholder="Chartered Engineer, Govt. Approved Valuer, Arbitrator & Surveyor empanelled with … L.NO.Cat-I/107/2009-10" onChange={(e) => setV({ ...v, letterhead: { ...v.letterhead, empanelment: e.target.value } })} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">{BILLING.map((f) => field('billing', f))}</div>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save report settings
        </Button>
      </CardContent>
    </Card>
  );
}
