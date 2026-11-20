import { useState } from 'react';

/**
 * Single-series horizontal bar list (magnitude comparison). One hue (brand primary), thin bars with a 4px rounded
 * data end anchored at the baseline, value printed in text ink beside each bar (so the list doubles as its own
 * table view), recessive track, and a hover / focus tooltip with the exact value and share.
 * @param {{ items: { key: string, label: string, value: number }[], format?: (n: number) => string, emptyText?: string, ariaLabel: string }} props
 */
export function BarList({ items, format = (n) => n.toLocaleString('en-IN'), emptyText = 'No data yet', ariaLabel }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!items.length || total === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {items.map((i) => {
        const pct = (i.value / max) * 100;
        const tip = `${i.label}: ${format(i.value)} (${Math.round((i.value / total) * 100)}% of total)`;
        return (
          <li
            key={i.key}
            tabIndex={0}
            className="relative grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            onMouseEnter={() => setHover(i.key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i.key)}
            onBlur={() => setHover(null)}
            aria-label={tip}
          >
            <span className="truncate text-sm text-muted-foreground">{i.label}</span>
            <span className="relative h-3 py-1" aria-hidden>
              <span className="absolute inset-y-0 left-0 w-full rounded-r bg-muted/60" />
              <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-primary transition-[width]" style={{ width: `${Math.max(pct, i.value ? 2 : 0)}%` }} />
            </span>
            <span className="tabular w-16 text-right text-sm font-medium text-foreground">{format(i.value)}</span>
            {hover === i.key && (
              <span role="tooltip" className="pointer-events-none absolute -top-8 left-40 z-10 whitespace-nowrap rounded-md border bg-card px-2 py-1 text-xs text-foreground shadow-md">
                {tip}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
