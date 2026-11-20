import { Input, Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import { formatDate, formatINR } from '@/utils/format';

/**
 * Renders a valuation category's configurable fields (from the category master) as a form or a read-only list.
 * The API re-validates every value against the same definitions.
 */
export function DynamicCategoryForm({ fields, values, onChange, readOnly }) {
  const sections = [...new Set(fields.map((f) => f.section))];
  const set = (k, v) => onChange({ ...values, [k]: v });

  const display = (f) => {
    const v = values?.[f.key];
    if (v === undefined || v === null || v === '') return '—';
    if (f.type === 'BOOLEAN') return v ? 'Yes' : 'No';
    if (f.type === 'CURRENCY') return formatINR(v);
    if (f.type === 'DATE') return formatDate(v);
    return `${v}${f.unit ? ` ${f.unit}` : ''}`;
  };

  const control = (f) => {
    const id = `pf-${f.key}`;
    const v = values?.[f.key] ?? '';
    switch (f.type) {
      case 'TEXTAREA':
        return <Textarea id={id} value={v} onChange={(e) => set(f.key, e.target.value)} maxLength={3000} />;
      case 'SELECT':
        return (
          <NativeSelect id={id} value={v} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">Select…</option>
            {(f.options || []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </NativeSelect>
        );
      case 'BOOLEAN':
        return (
          <NativeSelect id={id} value={v === '' ? '' : v ? 'yes' : 'no'} onChange={(e) => set(f.key, e.target.value === '' ? null : e.target.value === 'yes')}>
            <option value="">Not recorded</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </NativeSelect>
        );
      case 'NUMBER':
      case 'AREA':
      case 'CURRENCY':
        return (
          <div className="relative">
            <Input id={id} type="number" inputMode="decimal" min="0" step="any" value={v} onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value))} className={f.unit ? 'pr-14' : ''} />
            {f.unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{f.unit}</span>}
          </div>
        );
      case 'DATE':
        return <Input id={id} type="date" value={v} onChange={(e) => set(f.key, e.target.value || null)} />;
      default:
        return <Input id={id} value={v} onChange={(e) => set(f.key, e.target.value)} maxLength={300} />;
    }
  };

  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <fieldset key={s}>
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s}</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields
              .filter((f) => f.section === s)
              .map((f) =>
                readOnly ? (
                  <div key={f.key}>
                    <p className="text-xs text-muted-foreground">{f.label}</p>
                    <p className="mt-0.5 text-sm">{display(f)}</p>
                  </div>
                ) : (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={`pf-${f.key}`}>
                      {f.label}
                      {f.required && <span className="ml-0.5 text-destructive">*</span>}
                    </Label>
                    {control(f)}
                    {f.helpText && <p className="text-xs text-muted-foreground">{f.helpText}</p>}
                  </div>
                ),
              )}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
