import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Field } from '@/components/forms/Field';
import { emailField, gstinField, optionalText, panField, phoneField, pincodeField } from '@/utils/validation';

export const CLIENT_TYPES = [
  ['INDIVIDUAL', 'Individual'],
  ['PROPRIETORSHIP', 'Proprietorship'],
  ['PARTNERSHIP', 'Partnership'],
  ['LLP', 'LLP'],
  ['PRIVATE_LIMITED', 'Private Limited'],
  ['PUBLIC_LIMITED', 'Public Limited'],
  ['HUF', 'HUF'],
  ['TRUST', 'Trust'],
  ['OTHER', 'Other'],
];

const schema = z.object({
  clientType: z.enum(CLIENT_TYPES.map(([v]) => v)),
  name: z.string().trim().min(2, 'Client name is required').max(200),
  contactPerson: optionalText(150),
  email: optionalText(254, emailField),
  phone: optionalText(20, phoneField),
  altPhone: optionalText(20, phoneField),
  pan: optionalText(10, panField),
  gstin: optionalText(15, gstinField),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  state: optionalText(100),
  pincode: optionalText(10, pincodeField),
  notes: optionalText(1000),
  createPortalLogin: z.boolean().optional(),
});

/**
 * Client create / edit form. In edit mode the PAN field is blank: leave it empty to keep the stored PAN,
 * or enter a new one to replace it (the stored PAN is never sent back to the browser).
 */
export function ClientForm({ mode, defaultValues, onSubmit, submitLabel, onCancel, panMasked }) {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      clientType: 'INDIVIDUAL',
      name: '',
      contactPerson: '',
      email: '',
      phone: '',
      altPhone: '',
      pan: '',
      gstin: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      pincode: '',
      notes: '',
      createPortalLogin: false,
      ...defaultValues,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const text = (name, label, props = {}) => (
    <Field label={label} htmlFor={`client-${name}`} error={errors[name]?.message} required={props.required} hint={props.hint}>
      <Input id={`client-${name}`} aria-invalid={!!errors[name]} {...props.input} {...form.register(name)} />
    </Field>
  );
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client type" htmlFor="client-clientType" required>
          <NativeSelect id="client-clientType" {...form.register('clientType')}>
            {CLIENT_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {text('name', 'Client / entity name', { required: true })}
        {text('contactPerson', 'Contact person')}
        {text('email', 'Email', { input: { type: 'email' }, hint: 'Used as the client portal login' })}
        {text('phone', 'Mobile', { input: { type: 'tel' } })}
        {text('altPhone', 'Alternate phone', { input: { type: 'tel' } })}
        {text('pan', 'PAN', {
          input: { className: 'uppercase', autoComplete: 'off', placeholder: mode === 'edit' && panMasked ? `${panMasked} (leave blank to keep)` : 'ABCDE1234F' },
          hint: 'Encrypted at rest; only the last 4 characters are ever shown.',
        })}
        {text('gstin', 'GSTIN', { input: { className: 'uppercase' } })}
        {text('addressLine1', 'Address line 1')}
        {text('addressLine2', 'Address line 2')}
        {text('city', 'City')}
        {text('state', 'State')}
        {text('pincode', 'PIN code', { input: { inputMode: 'numeric' } })}
      </div>
      <Field label="Notes" htmlFor="client-notes" error={errors.notes?.message}>
        <Textarea id="client-notes" maxLength={1000} {...form.register('notes')} />
      </Field>
      {mode === 'create' && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register('createPortalLogin')} />
          <span>
            <span className="block text-sm font-medium">Create client portal login</span>
            <span className="block text-xs text-muted-foreground">Sends an invitation to the email above so the client can track cases, upload documents and sign reports.</span>
          </span>
        </label>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
