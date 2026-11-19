import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { clientsApi } from '@/services/adminApi';
import { Button, Card, CardContent } from '@/components/ui/primitives';
import { PageHeader } from '@/components/data/PageHeader';
import { InviteNotice } from '@/components/data/InviteNotice';
import { FormAlert } from '@/components/forms/FormAlert';
import { compact } from '@/utils/validation';
import { ClientForm } from './ClientForm';

export default function ClientNewPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const submit = async (v) => {
    setError(null);
    if (v.createPortalLogin && !v.email) return setError({ message: 'Enter the client email to create a portal login' });
    try {
      const res = await clientsApi.create(compact(v));
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['firm', 'summary'] });
      setResult(res);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <PageHeader title="Add client" crumbs={[{ label: 'Clients', href: '/clients' }, { label: 'Add' }]} />
      <Card className="max-w-4xl">
        <CardContent className="pt-5">
          {result ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="size-5 text-success" /> {result.client.name} registered as {result.client.clientCode}
              </p>
              {result.portal && <InviteNotice invite={result.portal} />}
              <div className="flex gap-2">
                <Button asChild>
                  <Link to={`/clients/${result.client.id}`}>Open client</Link>
                </Button>
                <Button variant="outline" onClick={() => setResult(null)}>
                  Add another
                </Button>
              </div>
            </div>
          ) : (
            <>
              <FormAlert error={error} className="mb-4" />
              <ClientForm mode="create" onSubmit={submit} submitLabel="Register client" onCancel={() => navigate('/clients')} />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
