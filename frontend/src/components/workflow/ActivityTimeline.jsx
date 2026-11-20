import { ArrowRight, Circle } from 'lucide-react';
import { ACTIVITY_LABEL, statusLabel } from '@/utils/caseStatus';
import { formatDateTime, humanize } from '@/utils/format';
import { EmptyState } from '@/components/data/States';

/** Vertical, chronological case activity timeline (append-only data from the API). */
export function ActivityTimeline({ items, showIp }) {
  if (!items?.length) return <EmptyState title="No activity yet" />;
  return (
    <ol className="relative ml-2 border-l pl-6">
      {items.map((a) => (
        <li key={a.id} className="mb-5 last:mb-0">
          <span className="absolute -left-[7px] mt-1 flex size-3.5 items-center justify-center rounded-full bg-card ring-2 ring-primary/30">
            <Circle className="size-2 fill-primary text-primary" />
          </span>
          <p className="text-sm font-medium">{ACTIVITY_LABEL[a.action] ?? humanize(a.action)}</p>
          {a.prevStatus && a.newStatus && a.prevStatus !== a.newStatus && (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {statusLabel(a.prevStatus)} <ArrowRight className="size-3" /> <span className="font-medium text-foreground">{statusLabel(a.newStatus)}</span>
            </p>
          )}
          {a.remarks && <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted px-2 py-1 text-sm">{a.remarks}</p>}
          {a.meta?.employeeName && <p className="mt-0.5 text-xs text-muted-foreground">{a.meta.stage ? `${humanize(a.meta.stage)}: ` : ''}{a.meta.employeeName}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {a.actorName}
            {a.actorRole ? ` · ${humanize(a.actorRole)}` : ''} · {formatDateTime(a.createdAt)}
            {showIp && a.ip ? ` · ${a.ip}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}
