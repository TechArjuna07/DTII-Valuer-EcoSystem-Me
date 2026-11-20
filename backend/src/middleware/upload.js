import multer from 'multer';
import { env } from '../config/env.js';
import { HttpError } from '../utils/errors.js';

/**
 * Single-file multipart upload held in memory (never written to a temp path), capped at UPLOAD_MAX_MB.
 * Content validation (type sniffing) happens in the documents module.
 */
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 1, fields: 20, fieldSize: 10_000, parts: 25 },
});

function singleFile(field = 'file') {
  const mw = parser.single(field);
  return (req, res, next) =>
    mw(req, res, (err) => {
      if (!err) return req.file ? next() : next(new HttpError(400, `Attach a file in the "${field}" field`));
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `The file is larger than ${env.UPLOAD_MAX_MB} MB`));
      return next(new HttpError(400, 'Invalid upload: send one file in the "file" field'));
    });
}

/** Same as singleFile() but the file is optional (metadata-only submissions are allowed). */
function optionalFile(field = 'file') {
  const mw = parser.single(field);
  return (req, res, next) =>
    mw(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `The file is larger than ${env.UPLOAD_MAX_MB} MB`));
      return next(new HttpError(400, `Invalid upload: send at most one file in the "${field}" field`));
    });
}

export { singleFile, optionalFile };
