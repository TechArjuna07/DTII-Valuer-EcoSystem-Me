import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env.js';

/**
 * Production storage: a PRIVATE AWS S3 bucket. Objects are written with server-side encryption and are only ever
 * read through short-lived pre-signed URLs (SIGNED_URL_TTL_SECONDS); no public URL exists.
 * Credentials come from the standard AWS chain (instance role in production) or S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.
 * Bucket / folder mapping: s3://S3_BUCKET/S3_PREFIX<key>.
 */
let client;
const s3 = () =>
  (client ??= new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ACCESS_KEY_ID ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } } : {}),
  }));
const fullKey = (key) => `${env.S3_PREFIX}${key}`;

async function putObject(key, buffer, { contentType, sha256Base64 } = {}) {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: fullKey(key),
      Body: buffer,
      ContentType: contentType ?? 'application/octet-stream',
      ServerSideEncryption: 'aws:kms',
      ...(sha256Base64 ? { ChecksumSHA256: sha256Base64 } : {}),
      // Never overwrite: versions are immutable.
      IfNoneMatch: '*',
    }),
  );
}

async function getBuffer(key) {
  const res = await s3().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: fullKey(key) }));
  return Buffer.from(await res.Body.transformToByteArray());
}

/** Pre-signed GET with forced Content-Type / Content-Disposition. */
function presignGet(key, { contentType, contentDisposition, expiresIn, bucket = env.S3_BUCKET }) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: bucket, Key: fullKey(key), ResponseContentType: contentType, ResponseContentDisposition: contentDisposition }),
    { expiresIn },
  );
}

const ping = () => s3().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));

export { putObject, getBuffer, presignGet, ping };
