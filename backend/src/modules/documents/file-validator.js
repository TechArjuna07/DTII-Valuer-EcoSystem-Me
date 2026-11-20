import path from 'node:path';

/**
 * Upload validation: extension allowlist + magic-byte sniffing (the browser-supplied MIME type is never trusted),
 * size limit, and file-name sanitisation. Executables, scripts, HTML and SVG are never accepted.
 */
const SIGNATURES = {
  pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  heic: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heif)$/.test(b.subarray(8, 12).toString('latin1')),
  zip: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  ole: (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  text: (b) => !b.subarray(0, 8192).includes(0),
};

const TYPES = {
  pdf: { mime: 'application/pdf', sig: 'pdf', inline: true },
  jpg: { mime: 'image/jpeg', sig: 'jpg', inline: true, image: true },
  jpeg: { mime: 'image/jpeg', sig: 'jpg', inline: true, image: true },
  png: { mime: 'image/png', sig: 'png', inline: true, image: true },
  webp: { mime: 'image/webp', sig: 'webp', inline: true, image: true },
  heic: { mime: 'image/heic', sig: 'heic', image: true },
  heif: { mime: 'image/heif', sig: 'heic', image: true },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: 'zip' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sig: 'zip' },
  doc: { mime: 'application/msword', sig: 'ole' },
  xls: { mime: 'application/vnd.ms-excel', sig: 'ole' },
  csv: { mime: 'text/csv', sig: 'text' },
};

class FileValidationError extends Error {}

/** Safe display name: no paths, control characters or reserved characters; keeps the extension. */
function sanitizeFileName(name) {
  const base = path.basename(String(name || 'file')).normalize('NFC');
  // eslint-disable-next-line no-control-regex -- removing control characters is the purpose of this expression
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 200);
}

/**
 * @param {{ originalname: string, buffer: Buffer, size: number }} file  multer memory file
 * @param {{ maxBytes: number, imagesOnly?: boolean }} opts
 * @returns {{ fileName: string, extension: string, mimeType: string, inline: boolean, image: boolean }}
 */
function validateFile(file, { maxBytes, imagesOnly = false }) {
  if (!file?.buffer?.length) throw new FileValidationError('The file is empty');
  if (file.size > maxBytes) throw new FileValidationError(`The file is larger than ${Math.round(maxBytes / 1048576)} MB`);
  const fileName = sanitizeFileName(file.originalname);
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const type = TYPES[extension];
  if (!type) throw new FileValidationError(`Files of type .${extension || '?'} are not allowed. Allowed: ${Object.keys(TYPES).join(', ')}`);
  if (imagesOnly && !type.image) throw new FileValidationError('Only photographs (JPG, PNG, WEBP, HEIC) are allowed here');
  if (!SIGNATURES[type.sig](file.buffer)) throw new FileValidationError(`The file content does not match a .${extension} file`);
  return { fileName, extension, mimeType: type.mime, inline: !!type.inline, image: !!type.image };
}

const ALLOWED_EXTENSIONS = Object.keys(TYPES);

export { validateFile, sanitizeFileName, FileValidationError, ALLOWED_EXTENSIONS, TYPES };
