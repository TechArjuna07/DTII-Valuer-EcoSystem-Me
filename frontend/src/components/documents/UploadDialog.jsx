import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { documentsApi } from '@/services/documentsApi';
import { mastersApi } from '@/services/casesApi';
import { useAuth } from '@/context/AuthContext';
import { Button, Input, Label, NativeSelect } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import { FormAlert } from '@/components/forms/FormAlert';
import { formatBytes } from '@/utils/format';
import { ACCEPT_ALL, ACCEPT_IMAGES, Dropzone } from './Dropzone';

/**
 * Upload a new document (or a new version of `documentId`) into a case folder.
 * @param {{ caseId: string, folders: {code,label,title}[], defaultFolder?: string, documentId?: string, requestId?: string, onClose: () => void }} props
 */
export function UploadDialog({ caseId, folders, defaultFolder, documentId, documentTitle, requestId, onClose }) {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const isClient = !me.employee && !!me.client;
  const [folder, setFolder] = useState(defaultFolder ?? folders[0]?.code);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [visibility, setVisibility] = useState('INTERNAL');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const types = useQuery({ queryKey: ['masters', 'document-types'], queryFn: () => mastersApi.documentTypes(), enabled: can('master.view') });

  const submit = async () => {
    setError(null);
    setProgress(0);
    try {
      await documentsApi.upload(caseId, { file, folder, title: title || undefined, documentTypeId, documentId, requestId, visibility: isClient ? undefined : visibility }, setProgress);
      toast.success(documentId ? 'New version uploaded' : 'Document uploaded');
      qc.invalidateQueries({ queryKey: ['documents', caseId] });
      qc.invalidateQueries({ queryKey: ['doc-requests', caseId] });
      qc.invalidateQueries({ queryKey: ['cases', 'detail', caseId] });
      onClose();
    } catch (e) {
      setError(e);
      setProgress(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={documentId ? `New version of “${documentTitle}”` : 'Upload document'} description="Every upload is checked, fingerprinted (SHA-256) and kept as an immutable version.">
        <div className="space-y-4">
          <FormAlert error={error} />
          {!documentId && folders.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="up-folder">Folder</Label>
              <NativeSelect id="up-folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
                {folders.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {file ? (
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <FileText className="size-5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <Button size="icon" variant="ghost" aria-label="Remove file" onClick={() => setFile(null)}>
                <X />
              </Button>
            </div>
          ) : (
            <Dropzone onFiles={(f) => setFile(f[0])} accept={folder === 'PROPERTY_PHOTOGRAPHS' ? ACCEPT_IMAGES : ACCEPT_ALL} capture={folder === 'PROPERTY_PHOTOGRAPHS' ? 'environment' : undefined} />
          )}
          {!documentId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="up-title">Title</Label>
                <Input id="up-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name ?? 'Defaults to the file name'} maxLength={200} />
              </div>
              {types.data && (
                <div className="space-y-1.5">
                  <Label htmlFor="up-type">Document type</Label>
                  <NativeSelect id="up-type" value={documentTypeId} onChange={(e) => setDocumentTypeId(e.target.value)}>
                    <option value="">Not classified</option>
                    {types.data.items.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
            </div>
          )}
          {!documentId && !isClient && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={visibility === 'CLIENT'} onChange={(e) => setVisibility(e.target.checked ? 'CLIENT' : 'INTERNAL')} />
              Visible to the client in their portal
            </label>
          )}
          {progress !== null && (
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!file} loading={progress !== null} onClick={submit}>
              Upload
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
