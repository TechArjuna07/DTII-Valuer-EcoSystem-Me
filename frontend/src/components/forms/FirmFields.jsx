import { z } from 'zod';
import { Input } from '@/components/ui/primitives';
import { emailField, gstinField, optionalText, phoneField, pincodeField } from '@/utils/validation';
import { Field } from './Field';

/** Firm profile fields shared by firm registration, Superadmin edit and the Firm Admin profile page. */
export const firmFieldsSchema = {
  name: z.string().trim().min(2, 'Firm name is required').max(200),
  legalName: optionalText(200),
  registrationNo: optionalText(64),
  gstin: optionalText(15, gstinField),
  email: emailField,
  phone: optionalText(20, phoneField),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  state: optionalText(100),
  pincode: optionalText(10, pincodeField),
};

export const firmDefaults = (f = {}) =>
  Object.fromEntries(Object.keys(firmFieldsSchema).map((k) => [k, f[k] ?? '']));

export function FirmFields({ register, errors, idPrefix = 'firm' }) {
  const f = (name, label, props = {}) => (
    <Field label={label} htmlFor={`${idPrefix}-${name}`} error={errors[name]?.message} required={props.required}>
      <Input id={`${idPrefix}-${name}`} aria-invalid={!!errors[name]} {...props.input} {...register(name)} />
    </Field>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {f('name', 'Firm name', { required: true })}
      {f('legalName', 'Legal name')}
      {f('email', 'Office email', { required: true, input: { type: 'email' } })}
      {f('phone', 'Phone', { input: { type: 'tel' } })}
      {f('registrationNo', 'Registration no.')}
      {f('gstin', 'GSTIN', { input: { className: 'uppercase' } })}
      {f('addressLine1', 'Address line 1')}
      {f('addressLine2', 'Address line 2')}
      {f('city', 'City')}
      {f('state', 'State')}
      {f('pincode', 'PIN code', { input: { inputMode: 'numeric' } })}
    </div>
  );
}
