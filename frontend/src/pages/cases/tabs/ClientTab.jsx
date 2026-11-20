import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { humanize } from '@/utils/format';

export default function ClientTab({ c, can }) {
  const cl = c.client;
  const rows = [
    ['Client code', <span key="c" className="font-mono">{cl.clientCode}</span>],
    ['Name', cl.name],
    ['Type', cl.clientType ? humanize(cl.clientType) : null],
    ['Contact person', cl.contactPerson],
    ['Email', cl.email],
    ['Phone', cl.phone],
    ['City', cl.city],
    ['PAN', cl.panMasked && <span className="font-mono">{cl.panMasked}</span>],
  ];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Client details</CardTitle>
        {can('client.manage') && (
          <Link to={`/clients/${cl.id}`} className="text-sm font-medium text-primary hover:underline">
            Open client record
          </Link>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm">{value || '—'}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
