import { z } from 'zod';

/** Client-side mirrors of API rules (for instant feedback; the API validates again). */

export const emailField = z.string().trim().min(1, 'Email is required').email('Enter a valid email');

export const passwordPolicy = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128, 'At most 128 characters')
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p), 'Use upper and lower case letters')
  .refine((p) => /[0-9\W_]/.test(p), 'Include a digit or a symbol');

/** '' → undefined so optional fields are omitted from API payloads. */
export const optionalText = (max, schema = z.string().trim().max(max)) => z.union([z.literal(''), schema]).optional();

export const phoneField = z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number');
export const pincodeField = z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code');
export const panField = z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN (e.g. ABCDE1234F)');
export const gstinField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid GSTIN');

/** Removes empty-string values; keeps null (explicit clear) when `keepNull`. */
export function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined));
}

/** For PATCH forms: empty strings become null so the API clears the field. */
export function emptyToNull(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === '' ? null : v]));
}
