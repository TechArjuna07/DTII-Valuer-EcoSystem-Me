import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CheckCircle2, CornerUpLeft, FileSignature, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { valuationsApi } from '@/services/valuationsApi';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Skeleton, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlays';
import { EmptyState, ErrorState } from '@/components/data/States';
import { ValuationVersions } from '@/components/valuation/ValuationVersions';
import { humanize } from '@/utils/format';
import { VersionEditor } from './PreliminaryTab';

export default function SeniorReviewTab({ c }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['valuations', c.id], queryFn: () => valuationsApi.get(c.id) });
  const [decision, setDecision] = useState(null);
  const [comments, setComments] = useState('');
  const [approving, setApproving] = useState(false);
  const [, setSp] = useSearchParams();
  const goSign = () => setSp({ tab: 'approval' }, { replace: true });
  const after = (res, msg) => {
    qc.setQueryData(['valuations', c.id], res);
    qc.invalidateQueries({ queryKey: ['cases', 'detail', c.id] });
    qc.invalidateQueries({ queryKey: ['timeline'] });
    toast.success(msg);
  };
  const review = useMutation({
    mutationFn: () => valuationsApi.review(c.id, decision, comments.trim() || undefined),
    onSuccess: (res) => (after(res, `Preliminary ${humanize(decision).toLowerCase()}`), setDecision(null), setComments('')),
    onError: (e) => toast.error(e.message),
  });
  const approve = useMutation({
    mutationFn: () => valuationsApi.approveFinal(c.id, comments.trim() || undefined),
    onSuccess: (res) => (after(res, 'Final report approved. Sign it to send it to the client.'), setApproving(false), goSign()),
    onError: (e) => toast.error(e.message),
  });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-96" />;
  const { permissions: perm, preliminary: p, final: f } = data;

  return (
    <div className="space-y-6">
      {c.status === 'FINAL_APPROVED' && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="font-medium">Next step: sign the final report as valuer</p>
              <p className="text-sm text-muted-foreground">After signing, the case waits for the fee; recording the payment completes it and releases the report to the client.</p>
            </div>
            <Button onClick={goSign}>
              <FileSignature /> Sign final report
            </Button>
          </CardContent>
        </Card>
      )}
      {perm.canReview && (
        <Card>
          <CardHeader>
            <CardTitle>Review preliminary valuation v{p.versions[0].version}</CardTitle>
            <CardDescription>Verify calculations and evidence (inspection, photographs, documents), then decide.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => setDecision('APPROVED')}>
              <CheckCircle2 /> Approve
            </Button>
            <Button variant="outline" onClick={() => setDecision('RETURNED')}>
              <CornerUpLeft /> Return for correction
            </Button>
            <Button variant="outline" className="text-destructive" onClick={() => setDecision('REJECTED')}>
              <XCircle /> Reject valuation
            </Button>
          </CardContent>
        </Card>
      )}
      {p && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Preliminary valuation <Badge tone={p.status === 'APPROVED' ? 'success' : 'primary'}>{humanize(p.status)}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ValuationVersions report={p} />
          </CardContent>
        </Card>
      )}
      {perm.canPrepareFinal && (
        <Card>
          <CardHeader>
            <CardTitle>Prepare final bank / NBFC report</CardTitle>
            <CardDescription>Rendered in the lender-specific format with a verification QR code, into 06_Final_Valuation_Report.</CardDescription>
          </CardHeader>
          <CardContent>
            <VersionEditor caseId={c.id} stage="final" engine={data.engine} initial={f?.versions[0]?.inputs ?? p.versions[0].inputs} rendererAvailable={data.rendererAvailable} templates={data.templates} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            Final valuation report {f && <Badge tone={f.status === 'APPROVED' ? 'success' : 'primary'}>{humanize(f.status)}</Badge>}
          </CardTitle>
          {perm.canApproveFinal && (
            <Button onClick={() => setApproving(true)}>
              <BadgeCheck /> Approve final report
            </Button>
          )}
        </CardHeader>
        <CardContent>{f?.versions.length ? <ValuationVersions report={f} /> : <EmptyState title="No final report yet" />}</CardContent>
      </Card>

      <ConfirmDialog
        open={!!decision}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision === 'APPROVED' ? 'Approve the preliminary valuation?' : decision === 'RETURNED' ? 'Return for correction?' : 'Reject this valuation?'}
        description={decision === 'REJECTED' ? 'The case will be closed as rejected.' : decision === 'RETURNED' ? 'The junior reviewer must correct and resubmit.' : 'You can then prepare the final bank report.'}
        confirmLabel={decision ? humanize(decision === 'APPROVED' ? 'APPROVE' : decision === 'RETURNED' ? 'RETURN' : 'REJECT') : ''}
        destructive={decision === 'REJECTED'}
        loading={review.isPending}
        onConfirm={() => (decision !== 'APPROVED' && comments.trim().length < 3 ? toast.error('Comments are required') : review.mutate())}
      >
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="review-comments">Comments{decision !== 'APPROVED' ? ' (required)' : ''}</Label>
          <Textarea id="review-comments" value={comments} onChange={(e) => setComments(e.target.value)} maxLength={3000} />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={approving}
        onOpenChange={setApproving}
        title="Approve and issue the final report?"
        description="The case moves to Final approved. Next: valuer digital signature and release to the client."
        confirmLabel="Approve"
        loading={approve.isPending}
        onConfirm={() => approve.mutate()}
      />
    </div>
  );
}
