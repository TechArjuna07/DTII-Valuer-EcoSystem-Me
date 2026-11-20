/**
 * Validation of category-specific property data against the category's configurable field definitions.
 * Unknown keys are rejected (no arbitrary JSON), types are enforced, SELECT values must be one of the options.
 * Required fields are enforced at inspection submission, so drafts can be saved incrementally.
 */

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function coerce(def, value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  switch (def.type) {
    case 'TEXT':
    case 'TEXTAREA': {
      const s = String(value).trim();
      return s.length <= (def.type === 'TEXT' ? 300 : 3000) ? { ok: true, value: s } : { ok: false, error: `${def.label} is too long` };
    }
    case 'NUMBER':
    case 'AREA':
    case 'CURRENCY': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
      return Number.isFinite(n) && n >= 0 && n < 1e13 ? { ok: true, value: n } : { ok: false, error: `${def.label} must be a positive number` };
    }
    case 'DATE':
      return isDate(value) ? { ok: true, value } : { ok: false, error: `${def.label} must be a date (YYYY-MM-DD)` };
    case 'BOOLEAN':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: `${def.label} must be yes or no` };
    case 'SELECT':
      return (def.options || []).includes(value) ? { ok: true, value } : { ok: false, error: `${def.label}: choose one of the listed options` };
    default:
      return { ok: false, error: `${def.label}: unsupported field type` };
  }
}

/** @returns {{ data: object, errors: string[] }} */
function validatePropertyData(fields, input) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const errors = [];
  const data = {};
  for (const [k, v] of Object.entries(input || {})) {
    const def = byKey.get(k);
    if (!def) {
      errors.push(`property ${k} is not a field of this category`);
      continue;
    }
    const r = coerce(def, v);
    if (r.ok) {
      if (r.value !== null) data[k] = r.value;
    } else errors.push(r.error);
  }
  return { data, errors };
}

const missingRequired = (fields, data) => fields.filter((f) => f.required && (data?.[f.key] === undefined || data?.[f.key] === null || data?.[f.key] === '')).map((f) => f.label);

export { validatePropertyData, missingRequired };
