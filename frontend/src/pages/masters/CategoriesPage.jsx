import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { mastersApi } from '@/services/casesApi';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import { PageHeader } from '@/components/data/PageHeader';
import { ErrorState } from '@/components/data/States';
import { FormAlert } from '@/components/forms/FormAlert';
import { humanize } from '@/utils/format';

const FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'AREA', 'CURRENCY', 'DATE', 'SELECT', 'BOOLEAN'];

function NewCategoryDialog({ onClose }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ code: '', name: '', engine: 'LAND_BUILDING', description: '' });
  const [error, setError] = useState(null);
  const m = useMutation({
    mutationFn: () => mastersApi.createCategory({ ...v, description: v.description || undefined }),
    onSuccess: () => {
      toast.success('Category created');
      qc.invalidateQueries({ queryKey: ['masters'] });
      onClose();
    },
    onError: setError,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New valuation category" description="Choose the calculation engine the valuation reports of this category use.">
        <FormAlert error={error} className="mb-3" />
        <div className="space-y-3">
          <div>
            <Label htmlFor="cat-code">Code</Label>
            <Input id="cat-code" className="mt-1.5 uppercase" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="SOLAR_PLANT" />
          </div>
          <div>
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" className="mt-1.5" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="cat-engine">Calculation engine</Label>
            <NativeSelect id="cat-engine" className="mt-1.5" value={v.engine} onChange={(e) => setV({ ...v, engine: e.target.value })}>
              <option value="LAND_BUILDING">Land & building</option>
              <option value="PLANT_MACHINERY">Plant & machinery</option>
              <option value="STOCK">Stock</option>
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="cat-desc">Description</Label>
            <Input id="cat-desc" className="mt-1.5" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldEditor({ category }) {
  const qc = useQueryClient();
  const empty = { key: '', section: 'General', label: '', type: 'TEXT', required: false, options: '', unit: '' };
  const [f, setF] = useState(empty);
  const [error, setError] = useState(null);
  const save = useMutation({
    mutationFn: () =>
      mastersApi.saveField(category.id, {
        key: f.key,
        section: f.section,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.type === 'SELECT' ? f.options.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
        unit: f.unit || undefined,
        sortOrder: category.fields.length,
      }),
    onSuccess: () => {
      toast.success('Field saved');
      setF(empty);
      setError(null);
      qc.invalidateQueries({ queryKey: ['masters'] });
    },
    onError: setError,
  });
  const remove = useMutation({
    mutationFn: (key) => mastersApi.removeField(category.id, key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['masters'] }),
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-3 border-t pt-4">
      {category.fields.map((x) => (
        <div key={x.key} className="flex items-center gap-2 text-sm">
          <span className="flex-1">
            {x.label} <span className="font-mono text-xs text-muted-foreground">{x.key}</span>
          </span>
          <Badge>{humanize(x.type)}</Badge>
          {x.required && <Badge tone="warning">required</Badge>}
          <Button size="icon" variant="ghost" aria-label={`Remove ${x.label}`} onClick={() => remove.mutate(x.key)}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <FormAlert error={error} />
      <div className="grid gap-2 sm:grid-cols-6">
        <Input aria-label="Field key" placeholder="key (camelCase)" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
        <Input aria-label="Label" placeholder="Label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} className="sm:col-span-2" />
        <Input aria-label="Section" placeholder="Section" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} />
        <NativeSelect aria-label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {humanize(t)}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /> Required
        </label>
        {f.type === 'SELECT' && <Input aria-label="Options" placeholder="Options, comma separated" value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} className="sm:col-span-4" />}
        {['AREA', 'NUMBER', 'CURRENCY'].includes(f.type) && <Input aria-label="Unit" placeholder="Unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />}
      </div>
      <Button size="sm" loading={save.isPending} disabled={!f.key || !f.label} onClick={() => save.mutate()}>
        <Plus /> Add field
      </Button>
    </div>
  );
}

/** Category master: platform categories (read-only) and the firm's own, each with configurable fields. */
export default function CategoriesPage() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['masters', 'categories', 'all'], queryFn: () => mastersApi.categories({ includeInactive: 'true' }) });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <PageHeader
        title="Valuation categories"
        description="Each category has its own property / asset fields and report calculation. Platform categories are maintained by DTII."
        actions={
          can('master.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New category
            </Button>
          )
        }
      />
      {isLoading && <Skeleton className="h-64" />}
      <div className="grid gap-6 lg:grid-cols-2">
        {data?.items.map((c) => {
          const sections = [...new Set(c.fields.map((f) => f.section))];
          return (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {c.name} {c.isPlatform && <Lock className="size-3.5 text-muted-foreground" aria-label="Platform category" />}
                  {!c.active && <Badge>inactive</Badge>}
                </CardTitle>
                <CardDescription>
                  <span className="font-mono">{c.code}</span> · engine {humanize(c.engine)} · {c.caseCount} cases · fields v{c.fieldsVersion}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {c.isPlatform || !can('master.manage') ? (
                  sections.map((s) => (
                    <div key={s}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s}</p>
                      <p className="mt-1 text-sm">
                        {c.fields
                          .filter((f) => f.section === s)
                          .map((f) => `${f.label}${f.required ? '*' : ''}`)
                          .join(' · ')}
                      </p>
                    </div>
                  ))
                ) : (
                  <FieldEditor category={c} />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {creating && <NewCategoryDialog onClose={() => setCreating(false)} />}
    </>
  );
}
