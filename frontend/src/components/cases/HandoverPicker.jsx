import { useQuery } from '@tanstack/react-query';
import { casesApi } from '@/services/casesApi';
import { Label, NativeSelect } from '@/components/ui/primitives';

const ROLE = { JUNIOR: 'junior reviewer', SENIOR: 'senior reviewer' };

/**
 * "Hand over to" picker shown when submitting a stage whose next reviewer is not assigned yet.
 * Empty value = leave it to the firm's rule (automatic least-loaded assignment, or the Firm Admin).
 */
export function HandoverPicker({ caseId, stage, value, onChange }) {
  const { data, isLoading } = useQuery({ queryKey: ['assignable', stage, caseId], queryFn: () => casesApi.assignable(stage, caseId) });
  const fallback = data?.autoAssign === 'LEAST_LOADED' ? 'Automatic: least-loaded reviewer' : 'Decide later: the Firm Admin assigns';
  return (
    <div className="mt-4 space-y-1.5">
      <Label htmlFor={`handover-${stage}`}>Hand over to {ROLE[stage]}</Label>
      <NativeSelect id={`handover-${stage}`} value={value} disabled={isLoading} onChange={(e) => onChange(e.target.value)}>
        <option value="">{fallback}</option>
        {data?.items.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} · {e.employeeCode} · {e.openAssignments} open
          </option>
        ))}
      </NativeSelect>
      {data && data.items.length === 0 && <p className="text-xs text-warning">No active employee has the {ROLE[stage]} role yet. Ask the Firm Admin to add one.</p>}
    </div>
  );
}
