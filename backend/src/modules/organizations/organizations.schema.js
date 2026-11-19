import { z } from 'zod';
import { listQuery } from '../../utils/pagination.js';

/** Optional field: empty strings from forms become null BEFORE validation. */
const opt = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable().optional());
const str = (max) => z.string().trim().max(max);
const phone = str(20).regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number');
const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email');
const pincode = str(10).regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code');
const gstin = str(15).toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid GSTIN');

/** Firm profile fields editable by Superadmin (and, partially, by the Firm Admin). */
const firmProfileFields = {
  name: str(200).min(2, 'Firm name is required'),
  legalName: opt(str(200)),
  registrationNo: opt(str(64)),
  gstin: opt(gstin),
  email,
  phone: opt(phone),
  addressLine1: opt(str(200)),
  addressLine2: opt(str(200)),
  city: opt(str(100)),
  state: opt(str(100)),
  pincode: opt(pincode),
};

const subscriptionFields = {
  subscriptionPlan: str(40).min(1).optional(),
  subscriptionStatus: z.enum(['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED']).optional(),
  subscriptionValidTill: opt(z.coerce.date()),
  maxUsers: opt(z.coerce.number().int().min(1).max(100000)),
};

const registerFirmBody = z.strictObject({
  ...firmProfileFields,
  ...subscriptionFields,
  admin: z.strictObject({
    fullName: str(150).min(2, 'Admin name is required'),
    email,
    phone: opt(phone),
    designation: opt(str(100)),
  }),
});

const updateFirmBody = z.strictObject({ ...firmProfileFields, ...subscriptionFields }).partial();
const firmStatusBody = z.strictObject({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']), reason: str(500).min(3, 'A reason is required') });
const listFirmsQuery = z.strictObject({ ...listQuery, status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional() });
const idParam = z.strictObject({ id: z.uuid() });
const adminParam = z.strictObject({ id: z.uuid(), userId: z.uuid() });

export { firmProfileFields, registerFirmBody, updateFirmBody, firmStatusBody, listFirmsQuery, idParam, adminParam, opt, str, phone, email, pincode, gstin };
