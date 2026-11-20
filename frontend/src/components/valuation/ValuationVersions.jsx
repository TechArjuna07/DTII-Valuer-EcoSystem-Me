import { Download, QrCode } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { openDocument } from '@/services/documentsApi';
import { Badge, Button } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import { formatDateTime, formatINR, humanize } from '@/utils/format';

export function ValuesSummary({ v }) {
  const rows = [
    ['Fair market value', v.marketValue, true],
    ['Realisable value', v.realisableValue],
    ['Distress value', v.distressValue],
    ['Guideline value', v.guidelineValue],
    ['Insurable value', v.insurableValue],
  ].filter(([, x]) => x != null);
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {rows.map(([l, x, main]) => (
        <div key={l} className={cn('rounded-lg border p-3', main && 'border-primary/30 bg-primary-soft')}>
          <dt className="text-xs text-muted-foreground">{l}</dt>
          <dd className={cn('tabular mt-1 font-semibold', main ? 'text-lg text-primary' : 'text-sm')}>{formatINR(x)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CalculationTable({ calculation }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-2 font-medium">Section</th>
            <th className="py-2 pr-2 font-medium">Particulars</th>
            <th className="py-2 pr-2 text-right font-medium">Quantity</th>
            <th className="py-2 pr-2 text-right font-medium">Rate</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {calculation.lines.map((l, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-2 pr-2 text-muted-foreground">{l.section}</td>
              <td className="py-2 pr-2">
                {l.label}
                {l.note && <span className="block text-xs text-muted-foreground">{l.note}</span>}
              </td>
              <td className="tabular py-2 pr-2 text-right">{l.quantity != null ? `${l.quantity} ${l.unit ?? ''}` : ''}</td>
              <td className="tabular py-2 pr-2 text-right">{l.rate != null ? formatINR(l.rate) : ''}</td>
              <td className={cn('tabular py-2 text-right', l.amount < 0 && 'text-destructive')}>{formatINR(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">{calculation.assumptions?.join(' · ')}</p>
    </div>
  );
}

/** Version history of a report: values, calculation, PDF, reviews. Latest first. */
export function ValuationVersions({ report }) {
  const [open, setOpen] = useState(report.versions[0]?.id);
  return (
    <ol className="space-y-3">
      {report.versions.map((v) => (
        <li key={v.id} className="rounded-xl border">
          <button className="flex w-full flex-wrap items-center gap-2 p-3 text-left" onClick={() => setOpen(open === v.id ? null : v.id)}>
            <span className="font-semibold">v{v.version}</span>
            {v.id === report.currentVersionId && <Badge tone="primary">current</Badge>}
            <span className="tabular text-sm">{formatINR(v.marketValue)}</span>
            <span className="text-xs text-muted-foreground">
              {v.preparedBy} · {formatDateTime(v.createdAt)}
            </span>
            {v.changeNote && <span className="text-xs italic text-muted-foreground">“{v.changeNote}”</span>}
            {v.reviews.map((r) => (
              <Badge key={r.id} tone={r.decision === 'APPROVED' ? 'success' : r.decision === 'RETURNED' ? 'warning' : 'danger'}>
                {humanize(r.decision)}
              </Badge>
            ))}
          </button>
          {open === v.id && (
            <div className="space-y-4 border-t p-4">
              <ValuesSummary v={v} />
              <CalculationTable calculation={v.calculation} />
              {v.summary && <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{v.summary}</p>}
              {v.reviews.map((r) => (
                <p key={r.id} className="rounded-lg border-l-4 border-warning bg-warning-soft/50 p-3 text-sm">
                  <span className="font-medium">{humanize(r.decision)}</span> by {r.reviewer} · {formatDateTime(r.createdAt)}
                  {r.comments && <span className="block">{r.comments}</span>}
                </p>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                {v.documentId ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => openDocument(v.documentId, { versionId: v.documentVersionId, disposition: 'inline' }).catch((e) => toast.error(e.message))}>
                      Preview PDF
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openDocument(v.documentId, { versionId: v.documentVersionId }).catch((e) => toast.error(e.message))}>
                      <Download /> Download PDF
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-warning">No PDF for this version — attach one.</span>
                )}
                {v.verificationCode && (
                  <a className="flex items-center gap-1 text-xs text-primary hover:underline" href={`/verify/${v.verificationCode}`} target="_blank" rel="noopener noreferrer">
                    <QrCode className="size-3.5" /> Verification {v.verificationCode}
                  </a>
                )}
              </div>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
