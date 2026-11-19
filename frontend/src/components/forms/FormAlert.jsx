import { cn } from '@/utils/cn';

/** Inline alert for form-level errors / notices. Lists every validation message returned by the API. */
export function FormAlert({ error, tone = 'danger', children, className }) {
  const messages = error ? (error.details?.length ? error.details : [error.message]) : null;
  if (!messages && !children) return null;
  const styles = {
    danger: 'border-destructive/20 bg-destructive-soft text-destructive',
    warning: 'border-warning/30 bg-warning-soft text-warning',
    success: 'border-success/20 bg-success-soft text-success',
    info: 'border-primary/20 bg-primary-soft text-primary',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-lg border px-3 py-2 text-sm', styles[tone], className)}>
      {children}
      {messages && (messages.length === 1 ? <p>{messages[0]}</p> : <ul className="list-disc space-y-0.5 pl-4">{messages.map((m) => <li key={m}>{m}</li>)}</ul>)}
    </div>
  );
}
