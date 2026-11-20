import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ShieldCheck, ShieldX } from 'lucide-react';
import { useParams } from 'react-router';
import { verifyApi } from '@/services/valuationsApi';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { formatDateTime, humanize } from '@/utils/format';

/**
 * Public report verification (QR code on every final report). Lets a bank confirm a report's provenance —
 * firm, Case ID, issue date, document fingerprint and signatures — without logging in. No values are shown.
 */
export default function VerifyReportPage() {
  const { code } = useParams();
  const { data, isLoading, error } = useQuery({ queryKey: ['verify', code], queryFn: () => verifyApi.verify(code), retry: false });
  if (isLoading) return <Skeleton className="h-64" />;
  if (error) {
    return (
      <div className="text-center">
        <ShieldX className="mx-auto size-10 text-destructive" />
        <h1 className="mt-3 text-xl font-semibold">Report not recognised</h1>
        <p className="mt-1 text-sm text-muted-foreground">No valuation report matches the code {code}. The document may be forged or mistyped.</p>
      </div>
    );
  }
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="size-7 text-success" />
        <h1 className="text-xl font-semibold">Valuation report verified</h1>
      </div>
      {!data.current && (
        <p className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4" /> This is an older version; a newer version of the report has been issued.
        </p>
      )}
      <Card className="divide-y text-sm">
        {[
          ['Case ID', <span key="c" className="font-mono">{data.caseNumber}</span>],
          ['Issued by', `${data.firm.name} (${data.firm.firmCode})`],
          ['Lender', `${data.lender.name}${data.lender.branch ? `, ${data.lender.branch}` : ''}`],
          ['Category', data.category],
          ['Report version', `v${data.version} · ${humanize(data.reportStatus)}`],
          ['Issued on', formatDateTime(data.issuedAt)],
        ].map(([l, v]) => (
          <div key={l} className="flex justify-between gap-4 px-4 py-2.5">
            <span className="text-muted-foreground">{l}</span>
            <span className="text-right font-medium">{v}</span>
          </div>
        ))}
        <div className="px-4 py-2.5">
          <p className="text-muted-foreground">Document fingerprint (SHA-256)</p>
          <p className="mt-1 break-all font-mono text-xs">{data.documentSha256 ?? '—'}</p>
          <p className="mt-1 text-xs text-muted-foreground">Compare with the SHA-256 of the PDF you received to confirm it has not been altered.</p>
        </div>
        <div className="px-4 py-2.5">
          <p className="mb-1 text-muted-foreground">Digital signatures</p>
          {data.signatures.length ? (
            data.signatures.map((s, i) => (
              <p key={i} className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="size-4 text-success" /> {s.name} ({humanize(s.role)}) · {formatDateTime(s.signedAt)} <Badge tone={s.legallyValid ? 'success' : 'warning'}>{s.legallyValid ? humanize(s.provider) : 'sandbox – not legally valid'}</Badge>
              </p>
            ))
          ) : (
            <p className="text-sm">No signatures recorded yet.</p>
          )}
        </div>
      </Card>
    </>
  );
}
