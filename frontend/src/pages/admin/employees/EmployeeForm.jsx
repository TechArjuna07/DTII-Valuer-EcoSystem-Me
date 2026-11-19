import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Input } from '@/components/ui/primitives';
import { Field } from '@/components/forms/Field';
import { emailField, optionalText, phoneField } from '@/utils/validation';
import { STAFF_ROLES } from './roles';

const base = {
  fullName: z.string().trim().min(2, 'Name is required').max(150),
  phone: optionalText(20, phoneField),
  designation: optionalText(100),
  department: optionalText(100),
  registrationNo: optionalText(64),
  dateOfJoining: z.string().optional(),
  roles: z.array(z.string()).min(1, 'Select at least one role'),
};
const createSchema = z.object({ ...base, email: emailField });
const editSchema = z.object(base);

/**
 * Create / edit employee form. Email (the login) is set once at registration.
 * @param {{ mode: 'create'|'edit', defaultValues?: object, onSubmit: (values) => Promise<void>, submitLabel: string, onCancel?: () => void }} props
 */
export function EmployeeForm({ mode, defaultValues, onSubmit, submitLabel, onCancel }) {
  const form = useForm({
    resolver: zodResolver(mode === 'create' ? createSchema : editSchema),
    defaultValues: { fullName: '', email: '', phone: '', designation: '', department: '', registrationNo: '', dateOfJoining: '', roles: [], ...defaultValues },
  });
  const { errors, isSubmitting } = form.formState;
  const text = (name, label, props = {}) => (
    <Field label={label} htmlFor={`emp-${name}`} error={errors[name]?.message} required={props.required} hint={props.hint}>
      <Input id={`emp-${name}`} aria-invalid={!!errors[name]} {...props.input} {...form.register(name)} />
    </Field>
  );
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {text('fullName', 'Full name', { required: true })}
        {mode === 'create' ? text('email', 'Email (login)', { required: true, input: { type: 'email' } }) : null}
        {text('phone', 'Phone', { input: { type: 'tel' } })}
        {text('designation', 'Designation')}
        {text('department', 'Department')}
        {text('registrationNo', 'Registration no.', { hint: 'IBBI / bank empanelment / engineer registration — shown on signed reports' })}
        {text('dateOfJoining', 'Date of joining', { input: { type: 'date' } })}
      </div>
      <fieldset>
        <legend className="text-sm font-medium">
          Roles <span className="text-destructive">*</span>
        </legend>
        <p className="mb-3 text-xs text-muted-foreground">One person can hold several roles. The same person can never prepare and approve the same valuation.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {STAFF_ROLES.map((r) => (
            <label key={r.code} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/50">
              <input type="checkbox" value={r.code} className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register('roles')} />
              <span>
                <span className="block text-sm font-medium">{r.name}</span>
                <span className="block text-xs text-muted-foreground">{r.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.roles && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {errors.roles.message}
          </p>
        )}
      </fieldset>
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
