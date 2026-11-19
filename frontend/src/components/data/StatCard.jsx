import { Link } from 'react-router';

/** Dashboard KPI tile. Becomes a link when `href` is given. */
export function StatCard({ label, value, icon, hint, href }) {
  const body = (
    <div className="flex h-full items-start justify-between rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-primary/30">
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="tabular mt-2 text-3xl font-semibold tracking-tight">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {icon && <div className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary [&_svg]:size-5">{icon}</div>}
    </div>
  );
  return href ? (
    <Link to={href} className="block focus-visible:outline-2">
      {body}
    </Link>
  ) : (
    body
  );
}
