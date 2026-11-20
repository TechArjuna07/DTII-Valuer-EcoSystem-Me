import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Development storage: plain files under STORAGE_LOCAL_ROOT whose relative paths equal the object keys, so the
 * folder can be synced to an S3 bucket as-is. Keys are generated from ids only; any key that would escape the
 * root (path traversal) is rejected.
 */
const root = path.resolve(env.STORAGE_LOCAL_ROOT);

function resolveKey(key) {
  if (typeof key !== 'string' || !/^[a-z0-9/_-]+$/i.test(key) || key.includes('..')) throw new Error('Invalid storage key');
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return full;
}

/** Atomic write: temp file + rename, never overwrites an existing object (versions are immutable). */
async function putObject(key, buffer) {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  try {
    await access(full);
    throw new Error('Object already exists');
  } catch (e) {
    if (e.message === 'Object already exists') throw e;
  }
  const tmp = `${full}.${randomUUID()}.tmp`;
  await writeFile(tmp, buffer, { flag: 'wx' });
  await rename(tmp, full);
}

async function getStream(key) {
  const full = resolveKey(key);
  const s = await stat(full);
  return { stream: createReadStream(full), size: s.size };
}

const getBuffer = (key) => readFile(resolveKey(key));

async function ping() {
  await mkdir(root, { recursive: true });
  await access(root);
}

export { putObject, getStream, getBuffer, ping, resolveKey };
