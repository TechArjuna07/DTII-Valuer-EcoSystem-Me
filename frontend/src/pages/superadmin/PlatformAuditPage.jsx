import { platformApi } from '@/services/adminApi';
import { PageHeader } from '@/components/data/PageHeader';
import { AuditLogTable } from '@/components/data/AuditLogTable';

export default function PlatformAuditPage() {
  return (
    <>
      <PageHeader title="Platform audit log" description="Sign-ins, firm registrations and status changes across the platform." crumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Audit log' }]} />
      <AuditLogTable fetcher={platformApi.auditLogs} queryKey={['platform', 'audit']} showFirm />
    </>
  );
}
