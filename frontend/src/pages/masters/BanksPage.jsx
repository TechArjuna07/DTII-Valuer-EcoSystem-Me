import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAuth } from '@/context/AuthContext';
import { mastersApi } from '@/services/casesApi';
import { useListParams } from '@/hooks/useListParams';
import { Badge, Button, Card, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import { PageHeader } from '@/components/data/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { SearchInput } from '@/components/data/SearchInput';
import { StatusBadge } from '@/components/data/StatusBadge';
import { EmptyState } from '@/components/data/States';
import { Field } from '@/components/forms/Field';
import { FormAlert } from '@/components/forms/FormAlert';
import { emailField, emptyToNull, optionalText, phoneField } from '@/utils/validation';

const TYPES = [
  ['BANK', 'Bank'],
  ['NBFC', 'NBFC'],
  ['HFC', 'Housing finance co.'],
  ['COOPERATIVE_BANK', 'Co-operative bank'],
  ['OTHER', 'Other'],
];
const TYPE_LABEL = Object.fromEntries(TYPES);

const schema = z.object({
  institutionType: z.enum(TYPES.map(([v]) => v)),
  name: z.string().trim().min(2, 'Name is required').max(150),
  shortCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/, '2–20 letters/digits, e.g. HDFC'),
  branch: optionalText(150),
  ifsc: optionalText(11, z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC')),
  contactPerson: optionalText(150),
  email: optionalText(254, emailField),
  phone: optionalText(20, phoneField),
  address: optionalText(400),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

function BankDialog({ bank, onClose }) {
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: bank
      ? Object.fromEntries(Object.keys(schema.shape).map((k) => [k, bank[k] ?? '']))
      : { institutionType: 'BANK', name: '', shortCode: '', branch: '', ifsc: '', contactPerson: '', email: '', phone: '', address: '', status: 'ACTIVE' },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const body = emptyToNull(v);
      if (bank) await mastersApi.updateBank(bank.id, body);
      else await mastersApi.createBank(Object.fromEntries(Object.entries(body).filter(([, x]) => x !== null)));
      toast.success(bank ? 'Bank updated' : 'Bank added');
      qc.invalidateQueries({ queryKey: ['masters'] });
      onClose();
    } catch (e) {
      setError(e);
    }
  });
  const t = (name, label, props = {}) => (
    <Field label={label} htmlFor={`bank-${name}`} error={errors[name]?.message} required={props.required} hint={props.hint}>
      <Input id={`bank-${name}`} aria-invalid={!!errors[name]} {...props.input} {...form.register(name)} />
    </Field>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={bank ? 'Edit bank / NBFC' : 'Add bank / NBFC'} className="max-w-2xl">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormAlert error={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Institution type" htmlFor="bank-type" required>
              <NativeSelect id="bank-type" {...form.register('institutionType')}>
                {TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {t('name', 'Name', { required: true })}
            {t('shortCode', 'Short code', { required: true, input: { className: 'uppercase' }, hint: 'Used in repository folder names, e.g. HDFC' })}
            {t('branch', 'Branch')}
            {t('ifsc', 'IFSC', { input: { className: 'uppercase' } })}
            {t('contactPerson', 'Contact person')}
            {t('email', 'Email', { input: { type: 'email' } })}
            {t('phone', 'Phone', { input: { type: 'tel' } })}
          </div>
          <Field label="Address" htmlFor="bank-address">
            <Textarea id="bank-address" maxLength={400} {...form.register('address')} />
          </Field>
          {bank && (
            <Field label="Status" htmlFor="bank-status">
              <NativeSelect id="bank-status" {...form.register('status')}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive (hidden from new cases)</option>
              </NativeSelect>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BanksPage() {
  const { can } = useAuth();
  const [params, set] = useListParams(['institutionType', 'status']);
  const [editing, setEditing] = useState(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['masters', 'banks', params], queryFn: () => mastersApi.banks(params), placeholderData: (p) => p });
  const columns = [
    { key: 'code', header: 'Code', cell: (b) => <span className="font-mono text-xs">{b.shortCode}</span> },
    {
      key: 'name',
      header: 'Institution',
      cell: (b) => (
        <div>
          <p className="font-medium">{b.name}</p>
          <p className="text-xs text-muted-foreground">{[b.branch, b.ifsc].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', cell: (b) => <Badge tone="primary">{TYPE_LABEL[b.institutionType]}</Badge>, className: 'hidden md:table-cell' },
    { key: 'contact', header: 'Contact', cell: (b) => b.contactPerson ?? '—', className: 'hidden lg:table-cell' },
    { key: 'cases', header: 'Cases', cell: (b) => <span className="tabular">{b.caseCount}</span>, className: 'hidden sm:table-cell' },
    { key: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Banks & NBFCs"
        description="Lenders your firm is empanelled with. One entry per branch."
        actions={
          can('master.manage') && (
            <Button onClick={() => setEditing({})}>
              <Plus /> Add bank / NBFC
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
          <SearchInput value={params.search} onChange={(v) => set('search', v)} placeholder="Name, code, branch, IFSC…" />
          <NativeSelect aria-label="Type" className="sm:w-48" value={params.institutionType} onChange={(e) => set('institutionType', e.target.value)}>
            <option value="">All types</option>
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <DataTable
          columns={columns}
          rows={data?.items}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          onRowClick={can('master.manage') ? (b) => setEditing(b) : undefined}
          empty={<EmptyState icon={<Landmark className="size-5" />} title="No banks yet" description="Add the banks and NBFCs that send you valuation work." />}
          page={data?.page}
          totalPages={data?.totalPages}
          total={data?.total}
          onPageChange={(p) => set('page', p)}
        />
      </Card>
      {editing && <BankDialog bank={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </>
  );
}
