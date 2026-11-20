import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, Eye, EyeOff, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { documentsApi, openDocument } from '@/services/documentsApi';
import { Badge, Button, Label, Skeleton, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/overlays';
import { formatBytes, formatDateTime, humanize } from '@/utils/format';

const SCAN_TONE = { CLEAN: 'success', SKIPPED: 'neutral', PENDING: 'warning', INFECTED: 'danger', ERROR: 'danger' };
const PREVIEWABLE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/** Side sheet: inline preview, metadata, version history, download, visibility, archive. */
export function DocumentDrawer({ documentId, canWrite, onNewVersion, onClose }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const isClient = !me.employee && !!me.client;
  const isAdmin = me.context.roles.some((r) => r.code === 'FIRM_ADMIN');
  const [preview, setPreview] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [reason, setReason] = useState('');
  const { data: d, isLoading } = useQuery({ queryKey: ['document', documentId], queryFn: () => documentsApi.get(documentId) });

  const showPreview = async () => {
    try {
      const { url } = await documentsApi.link(documentId, { disposition: 'inline' });
      setPreview(url);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const visibility = useMutation({
    mutationFn: () => documentsApi.update(documentId, { visibility: d.visibility === 'CLIENT' ? 'INTERNAL' : 'CLIENT' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', documentId] });
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const archive = useMutation({
    mutationFn: () => documentsApi.archive(documentId, reason),
    onSuccess: () => {
      toast.success('Document archived');
      qc.invalidateQueries({ queryKey: ['documents'] });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side title={d?.title ?? 'Document'} description={d ? `${humanize(d.folder)} · ${d.versionCount} version(s)` : undefined}>
        {isLoading || !d ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="space-y-5">
            {preview ? (
              d.current.mimeType === 'application/pdf' ? (
                <iframe title="Document preview" src={preview} className="h-[60vh] w-full rounded-lg border" />
              ) : (
                <img src={preview} alt={d.title} className="max-h-[60vh] w-full rounded-lg border object-contain" />
              )
            ) : (
              PREVIEWABLE.includes(d.current?.mimeType) &&
              d.current.downloadable && (
                <Button variant="outline" className="w-full" onClick={showPreview}>
                  <Eye /> Preview
                </Button>
              )
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!d.current?.downloadable} onClick={() => openDocument(d.id).catch((e) => toast.error(e.message))}>
                <Download /> Download
              </Button>
              {canWrite && onNewVersion && (
                <Button variant="outline" onClick={() => onNewVersion(d)}>
                  <Upload /> New version
                </Button>
              )}
              {canWrite && !isClient && (
                <Button variant="outline" loading={visibility.isPending} onClick={() => visibility.mutate()}>
                  {d.visibility === 'CLIENT' ? <EyeOff /> : <Eye />} {d.visibility === 'CLIENT' ? 'Hide from client' : 'Share with client'}
                </Button>
              )}
              {isAdmin && (
                <Button variant="ghost" className="text-destructive" onClick={() => setArchiving(true)}>
                  <Archive /> Archive
                </Button>
              )}
            </div>
            {!isClient && <Badge tone={d.visibility === 'CLIENT' ? 'primary' : 'neutral'}>{d.visibility === 'CLIENT' ? 'Visible to client' : 'Internal'}</Badge>}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Version history</h4>
              <ol className="space-y-2">
                {d.versions.map((v) => (
                  <li key={v.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">v{v.version}</span>
                      <span className="min-w-0 flex-1 truncate">{v.originalName}</span>
                      <Badge tone={SCAN_TONE[v.scanStatus]}>{v.scanStatus === 'SKIPPED' ? 'not scanned (dev)' : v.scanStatus.toLowerCase()}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatBytes(v.sizeBytes)} · {v.uploadedBy ?? humanize(v.uploadSource)} · {formatDateTime(v.createdAt)}
                    </p>
                    {!isClient && <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">SHA-256 {v.sha256}</p>}
                    {v.downloadable && v.id !== d.current.id && (
                      <Button size="sm" variant="link" onClick={() => openDocument(d.id, { versionId: v.id }).catch((e) => toast.error(e.message))}>
                        Download this version
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
        <ConfirmDialog
          open={archiving}
          onOpenChange={setArchiving}
          title="Archive this document?"
          description="It disappears from the repository. Every version is retained and the action is recorded."
          confirmLabel="Archive"
          destructive
          loading={archive.isPending}
          onConfirm={() => (reason.trim().length < 3 ? toast.error('Enter a reason') : archive.mutate())}
        >
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="archive-reason">Reason</Label>
            <Textarea id="archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </ConfirmDialog>
      </DialogContent>
    </Dialog>
  );
}
