import argon2 from 'argon2';
import { z } from 'zod';

/** Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

const hashPassword = (plain) => argon2.hash(plain, OPTIONS);
const needsRehash = (hash) => argon2.needsRehash(hash, OPTIONS);

async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Verified against when the account does not exist, so response time does not reveal valid emails.
let dummyHash;
async function burnPasswordCheck(plain) {
  dummyHash ??= await hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(dummyHash, plain);
}

/** Password policy: 10–128 characters with upper case, lower case and a digit or symbol. */
const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p), 'Password must contain upper and lower case letters')
  .refine((p) => /[0-9\W_]/.test(p), 'Password must contain a digit or a symbol');

/** Rejects passwords that contain the account's email name. */
function passwordContainsEmail(password, email) {
  const local = String(email).split('@')[0].toLowerCase();
  return local.length >= 4 && password.toLowerCase().includes(local);
}

export { hashPassword, verifyPassword, needsRehash, burnPasswordCheck, passwordSchema, passwordContainsEmail };
