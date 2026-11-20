import { UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/utils/cn';

export const ACCEPT_ALL = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.csv';
export const ACCEPT_IMAGES = '.jpg,.jpeg,.png,.webp,.heic,.heif';

/**
 * Drag-and-drop / click-to-browse file picker. `capture` opens the camera directly on mobile.
 * Validation happens server-side (type sniffing, size); the accept list only helps the user.
 */
export function Dropzone({ onFiles, accept = ACCEPT_ALL, multiple = false, capture, disabled, hint }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const pick = (list) => list?.length && onFiles(multiple ? [...list] : [list[0]]);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !disabled && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) pick(e.dataTransfer.files);
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition',
        over ? 'border-primary bg-primary-soft/60' : 'border-input hover:border-primary/50 hover:bg-accent/50',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <UploadCloud className="mb-2 size-7 text-primary" />
      <p className="text-sm font-medium">Drop {multiple ? 'files' : 'a file'} here or click to browse</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint ?? 'PDF, images, Word, Excel or CSV · up to 25 MB'}</p>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        capture={capture}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
