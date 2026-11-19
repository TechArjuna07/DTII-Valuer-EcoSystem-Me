import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { employeesApi } from '@/services/adminApi';
import { Button, Card, CardContent } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { InviteNotice } from '@/components/data/InviteNotice';
import { FormAlert } from '@/components/forms/FormAlert';
import { compact } from '@/utils/validation';
import { EmployeeForm } from './EmployeeForm';

export default function EmployeeNewPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const submit = async (v) => {
    setError(null);
    try {
      const res = await employeesApi.create(compact(v));
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['firm', 'summary'] });
      setResult(res);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <PageHeader title="Add employee" crumbs={[{ label: 'Employees', href: '/employees' }, { label: 'Add' }]} />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          {result ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="size-5 text-success" /> {result.employee.user.fullName} registered as {result.employee.employeeCode}
              </p>
              <InviteNotice invite={result.invite} />
              <div className="flex gap-2">
                <Button asChild>
                  <Link to={`/employees/${result.employee.id}`}>Open employee</Link>
                </Button>
                <Button variant="outline" onClick={() => setResult(null)}>
                  Add another
                </Button>
              </div>
            </div>
          ) : (
            <>
              <FormAlert error={error} className="mb-4" />
              <EmployeeForm mode="create" onSubmit={submit} submitLabel="Register & send invite" onCancel={() => navigate('/employees')} />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
