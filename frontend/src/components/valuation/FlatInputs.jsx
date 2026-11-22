import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Label, NativeSelect, Textarea } from '@/components/ui/primitives';

/**
 * Inputs of the FLAT engine (bank / SBI composite-rate flat report): the calculation, plus the report narrative of
 * sections IV–VI (marketability, rate analysis, methodology) and the declaration particulars. Property particulars
 * (sections I–III) come from the case's property details.
 */

function Num({ label, value, onChange, disabled, suffix, step = 'any', hint }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input type="number" inputMode="decimal" min="0" step={step} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className={suffix ? 'pr-14' : ''} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Text({ label, value, onChange, disabled, rows, placeholder }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {rows ? (
        <Textarea rows={rows} value={value ?? ''} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input value={value ?? ''} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

const Section = ({ title, children }) => (
  <fieldset className="space-y-3">
    <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>
    {children}
  </fieldset>
);

export function FlatInputs({ v, set, disabled }) {
  const r = v.report ?? {};
  const setR = (k) => (x) => set(['report', k], x);
  const extras = v.extras ?? [];
  const unit = v.areaUnit ?? 'sq.ft';
  return (
    <div className="space-y-6">
      <Section title="Area & composite rate">
        <div className="grid gap-3 sm:grid-cols-4">
          <Num label="Area" value={v.builtUpArea} onChange={(x) => set(['builtUpArea'], x)} disabled={disabled} />
          <div className="space-y-1.5">
            <Label className="text-xs">Unit</Label>
            <NativeSelect value={unit} disabled={disabled} onChange={(e) => set(['areaUnit'], e.target.value)}>
              <option>sq.ft</option>
              <option>sq.m</option>
            </NativeSelect>
          </div>
          <Text label="Area basis" value={v.areaBasis} onChange={(x) => set(['areaBasis'], x)} disabled={disabled} placeholder="Built up area" />
          <Num label={`Composite market rate (₹ / ${unit})`} value={v.compositeRate} onChange={(x) => set(['compositeRate'], x)} disabled={disabled} />
        </div>
      </Section>

      <Section title="Depreciation on construction cost">
        <div className="grid gap-3 sm:grid-cols-4">
          <Num label={`Construction cost (₹ / ${unit})`} value={v.constructionCostPerUnit} onChange={(x) => set(['constructionCostPerUnit'], x)} disabled={disabled} />
          <Num label="Age of building" value={v.ageYears} onChange={(x) => set(['ageYears'], x)} disabled={disabled} suffix="years" />
          <Num label="Total life" value={v.totalLifeYears} onChange={(x) => set(['totalLifeYears'], x)} disabled={disabled} suffix="years" />
          <Num label="Salvage value" value={v.salvagePct} onChange={(x) => set(['salvagePct'], x)} disabled={disabled} suffix="%" hint="(100 − salvage) ÷ life = % per year" />
        </div>
      </Section>

      <Section title="Other values">
        <div className="grid gap-3 sm:grid-cols-3">
          <Num label="Realisable value" value={v.realisablePct} onChange={(x) => set(['realisablePct'], x)} disabled={disabled} suffix="% of FMV" />
          <Num label="Distress value" value={v.distressPct} onChange={(x) => set(['distressPct'], x)} disabled={disabled} suffix="% of FMV" />
          <Num label="Book value (₹)" value={v.bookValue} onChange={(x) => set(['bookValue'], x === '' ? undefined : x)} disabled={disabled} hint="e.g. agreement value" />
          <Num label="Guideline (ready reckoner) rate (₹ / sq.m)" value={v.guidelineRatePerSqM} onChange={(x) => set(['guidelineRatePerSqM'], x === '' ? undefined : x)} disabled={disabled} />
          <Num label="Market value as per ready reckoner (₹)" value={v.readyReckonerValue} onChange={(x) => set(['readyReckonerValue'], x === '' ? undefined : x)} disabled={disabled} hint="From the eASR / stamp-duty calculation; leave blank to use rate × area" />
          <Num label="Round values to (₹)" value={v.roundTo} onChange={(x) => set(['roundTo'], x)} disabled={disabled} step="1" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Extras (wardrobes, showcases, kitchen arrangements, interior decoration…)</Label>
          {extras.map((e, idx) => (
            <div key={idx} className="flex gap-2">
              <Input value={e.description} disabled={disabled} placeholder="Description" onChange={(ev) => set(['extras'], extras.map((x, j) => (j === idx ? { ...x, description: ev.target.value } : x)))} />
              <Input type="number" min="0" className="w-40" value={e.amount ?? ''} disabled={disabled} placeholder="Amount ₹" onChange={(ev) => set(['extras'], extras.map((x, j) => (j === idx ? { ...x, amount: ev.target.value === '' ? '' : Number(ev.target.value) } : x)))} />
              {!disabled && (
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => set(['extras'], extras.filter((_x, j) => j !== idx))}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          {!disabled && (
            <Button size="sm" variant="outline" onClick={() => set(['extras'], [...extras, { description: '', amount: 0 }])}>
              <Plus /> Add extra
            </Button>
          )}
        </div>
      </Section>

      <Section title="Report particulars (section I & declaration)">
        <div className="grid gap-3 sm:grid-cols-3">
          <Text label="Purpose of valuation" value={r.purpose} onChange={setR('purpose')} disabled={disabled} placeholder="To avail Housing Loan" />
          <Text label="Date of appointment" value={r.appointmentDate} onChange={setR('appointmentDate')} disabled={disabled} placeholder="e.g. 17/11/2026" />
          <Text label="Place" value={r.place} onChange={setR('place')} disabled={disabled} placeholder="e.g. Andheri, Mumbai" />
          <Text label="Appointing authority" value={r.appointingAuthority} onChange={setR('appointingAuthority')} disabled={disabled} placeholder="The Asst. General Manager, State Bank of India, …" />
          <Text label="Property visited by" value={r.inspectedBy} onChange={setR('inspectedBy')} disabled={disabled} placeholder="Defaults to the field officer" />
        </div>
        <Text
          label="Documents produced for perusal (one per line)"
          rows={4}
          value={(r.documents ?? []).join('\n')}
          onChange={(x) => set(['report', 'documents'], x.split('\n').map((s) => s.trimStart()).filter((s, i, a) => s || i < a.length - 1))}
          disabled={disabled}
          placeholder={'Copy of Agreement for Sale dated …\nCopy of Occupation Certificate …'}
        />
      </Section>

      <Section title="IV Marketability & V Rate">
        <div className="grid gap-3 sm:grid-cols-3">
          <Text label="How is the marketability" value={r.marketability} onChange={setR('marketability')} disabled={disabled} placeholder="Good" />
          <Text label="Factors favouring an extra potential value" value={r.positiveFactors} onChange={setR('positiveFactors')} disabled={disabled} />
          <Text label="Negative factors" value={r.negativeFactors} onChange={setR('negativeFactors')} disabled={disabled} placeholder="None" />
        </div>
        <Text label="Comparable sale instances / composite rate in the adjoining locality" rows={3} value={r.comparableAnalysis} onChange={setR('comparableAnalysis')} disabled={disabled} />
        <Text label="Adopted basic composite rate (as new construction) — details" rows={2} value={r.adoptedRateNote} onChange={setR('adoptedRateNote')} disabled={disabled} />
        <Text label="Break-up of the rate (building + services / land + others)" rows={2} value={r.rateBreakupNote} onChange={setR('rateBreakupNote')} disabled={disabled} placeholder="The rate mentioned above is inclusive of all and can be called as composite rate." />
      </Section>

      <Section title="Valuation methodology">
        <Text label="Methodology" rows={3} value={r.methodology} onChange={setR('methodology')} disabled={disabled} />
        <Text label="Justification if the value differs from the Govt. rate by more than 20%" rows={3} value={r.deviationJustification} onChange={setR('deviationJustification')} disabled={disabled} />
      </Section>
    </div>
  );
}
