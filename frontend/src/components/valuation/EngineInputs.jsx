import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Label, NativeSelect } from '@/components/ui/primitives';
import { FlatInputs } from './FlatInputs';

/** Numeric input bound to a nested path of the inputs object. */
function Num({ label, value, onChange, disabled, step = 'any', suffix }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input type="number" inputMode="decimal" min="0" step={step} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className={suffix ? 'pr-12' : ''} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

const setIn = (obj, path, v) => {
  const [head, ...rest] = path;
  if (!rest.length) return { ...obj, [head]: v };
  return { ...obj, [head]: setIn(obj?.[head] ?? {}, rest, v) };
};

function Common({ v, set, disabled }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Num label="Realisable value %" value={v.realisablePct} onChange={(x) => set(['realisablePct'], x)} disabled={disabled} suffix="%" />
      <Num label="Distress value %" value={v.distressPct} onChange={(x) => set(['distressPct'], x)} disabled={disabled} suffix="%" />
      <Num label="Round to (₹)" value={v.roundTo} onChange={(x) => set(['roundTo'], x)} disabled={disabled} step="1" />
    </div>
  );
}

function LandBuilding({ v, set, disabled }) {
  const hasBuilding = !!v.building;
  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Land</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          <Num label="Area" value={v.land?.area} onChange={(x) => set(['land', 'area'], x)} disabled={disabled} />
          <div className="space-y-1.5">
            <Label className="text-xs">Unit</Label>
            <NativeSelect value={v.land?.unit ?? 'sq.ft'} disabled={disabled} onChange={(e) => set(['land', 'unit'], e.target.value)}>
              {['sq.ft', 'sq.m', 'acre', 'hectare', 'guntha'].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </NativeSelect>
          </div>
          <Num label="Market rate per unit (₹)" value={v.land?.ratePerUnit} onChange={(x) => set(['land', 'ratePerUnit'], x)} disabled={disabled} />
          <Num label="Guideline rate per unit (₹)" value={v.land?.guidelineRatePerUnit} onChange={(x) => set(['land', 'guidelineRatePerUnit'], x === '' ? undefined : x)} disabled={disabled} />
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Building
          {!disabled && (
            <label className="flex items-center gap-1.5 font-normal normal-case">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={hasBuilding} onChange={(e) => set(['building'], e.target.checked ? { builtUpArea: 0, unit: 'sq.ft', replacementRatePerUnit: 0, ageYears: 0, totalLifeYears: 60, salvagePct: 10 } : undefined)} /> include
            </label>
          )}
        </legend>
        {hasBuilding && (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Num label="Built-up area" value={v.building.builtUpArea} onChange={(x) => set(['building', 'builtUpArea'], x)} disabled={disabled} suffix={v.building.unit} />
            <Num label="Replacement rate (₹ / unit)" value={v.building.replacementRatePerUnit} onChange={(x) => set(['building', 'replacementRatePerUnit'], x)} disabled={disabled} />
            <Num label="Age (years)" value={v.building.ageYears} onChange={(x) => set(['building', 'ageYears'], x)} disabled={disabled} />
            <Num label="Total life (years)" value={v.building.totalLifeYears} onChange={(x) => set(['building', 'totalLifeYears'], x)} disabled={disabled} />
            <Num label="Salvage %" value={v.building.salvagePct} onChange={(x) => set(['building', 'salvagePct'], x)} disabled={disabled} suffix="%" />
          </div>
        )}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amenities / extra items</legend>
        {(v.amenities ?? []).map((a, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
            <Input aria-label="Description" value={a.description} disabled={disabled} onChange={(e) => set(['amenities'], v.amenities.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <Input aria-label="Amount" type="number" min="0" value={a.amount} disabled={disabled} onChange={(e) => set(['amenities'], v.amenities.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
            {!disabled && (
              <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => set(['amenities'], v.amenities.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
        {!disabled && (
          <Button size="sm" variant="outline" onClick={() => set(['amenities'], [...(v.amenities ?? []), { description: '', amount: 0 }])}>
            <Plus /> Add item
          </Button>
        )}
      </fieldset>
      <Common v={v} set={set} disabled={disabled} />
    </div>
  );
}

function ItemsTable({ v, set, disabled, columns, blank }) {
  const items = v.items ?? [];
  const upd = (i, k, x) => set(['items'], items.map((it, j) => (j === i ? { ...it, [k]: x } : it)));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {columns.map((c) => (
                <th key={c.key} className="px-1 pb-1 font-medium">
                  {c.label}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="p-1">
                    {c.options ? (
                      <NativeSelect value={it[c.key]} disabled={disabled} onChange={(e) => upd(i, c.key, e.target.value)}>
                        {c.options.map(([ov, ol]) => (
                          <option key={ov} value={ov}>
                            {ol}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Input
                        type={c.number ? 'number' : 'text'}
                        min={c.number ? 0 : undefined}
                        step="any"
                        value={it[c.key] ?? ''}
                        disabled={disabled}
                        onChange={(e) => upd(i, c.key, c.number ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
                        aria-label={c.label}
                      />
                    )}
                  </td>
                ))}
                <td className="p-1">
                  {!disabled && (
                    <Button size="icon" variant="ghost" aria-label="Remove line" onClick={() => set(['items'], items.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <Button size="sm" variant="outline" onClick={() => set(['items'], [...items, blank])}>
          <Plus /> Add line
        </Button>
      )}
    </div>
  );
}

/** Inputs editor for the category's calculation engine. The API recalculates everything from these inputs. */
export function EngineInputs({ engine, value, onChange, disabled }) {
  const set = (path, v) => onChange(setIn(value, path, v));
  if (engine === 'LAND_BUILDING') return <LandBuilding v={value} set={set} disabled={disabled} />;
  if (engine === 'FLAT') return <FlatInputs v={value} set={set} disabled={disabled} />;
  if (engine === 'PLANT_MACHINERY') {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Num label="Valuation year" value={value.valuationYear} onChange={(x) => set(['valuationYear'], x)} disabled={disabled} step="1" />
          <Num label="Salvage %" value={value.salvagePct} onChange={(x) => set(['salvagePct'], x)} disabled={disabled} suffix="%" />
        </div>
        <ItemsTable
          v={value}
          set={set}
          disabled={disabled}
          blank={{ description: '', make: '', quantity: 1, yearOfPurchase: value.valuationYear, replacementCostNew: 0, usefulLifeYears: 15, conditionFactor: 1 }}
          columns={[
            { key: 'description', label: 'Machine' },
            { key: 'make', label: 'Make / model' },
            { key: 'quantity', label: 'Qty', number: true },
            { key: 'yearOfPurchase', label: 'Year bought', number: true },
            { key: 'replacementCostNew', label: 'Replacement cost new (₹ each)', number: true },
            { key: 'usefulLifeYears', label: 'Life (yrs)', number: true },
            { key: 'conditionFactor', label: 'Condition ×', number: true },
          ]}
        />
        <Common v={value} set={set} disabled={disabled} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ItemsTable
        v={value}
        set={set}
        disabled={disabled}
        blank={{ description: '', category: 'RAW_MATERIAL', quantity: 0, unit: 'nos', ratePerUnit: 0, obsolescencePct: 0 }}
        columns={[
          { key: 'description', label: 'Item' },
          { key: 'category', label: 'Type', options: [['RAW_MATERIAL', 'Raw material'], ['WORK_IN_PROGRESS', 'WIP'], ['FINISHED_GOODS', 'Finished goods'], ['TRADING_GOODS', 'Trading goods'], ['OTHER', 'Other']] },
          { key: 'quantity', label: 'Quantity', number: true },
          { key: 'unit', label: 'Unit' },
          { key: 'ratePerUnit', label: 'Rate (₹)', number: true },
          { key: 'obsolescencePct', label: 'Obsolescence %', number: true },
        ]}
      />
      <Common v={value} set={set} disabled={disabled} />
    </div>
  );
}

/** Strips '' placeholders so optional numeric fields are omitted. */
export function cleanInputs(v) {
  if (Array.isArray(v)) return v.map(cleanInputs);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== undefined).map(([k, x]) => [k, cleanInputs(x)]));
  return v;
}
