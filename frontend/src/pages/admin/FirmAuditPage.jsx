import { firmApi } from '@/services/adminApi';
import { PageHeader } from '@/components/data/PageHeader';
import { AuditLogTable } from '@/components/data/AuditLogTable';

export default function FirmAuditPage() {
  return (
    <>
      <PageHeader title="Audit trail" description="Every sign-in, registration and change in your firm. Records cannot be edited or deleted." />
      <AuditLogTable fetcher={firmApi.auditLogs} queryKey={['firm', 'audit']} />
    </>
  );
}
