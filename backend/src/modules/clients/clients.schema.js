import { z } from 'zod';
import { listQuery } from '../../utils/pagination.js';
import { email, gstin, opt, phone, pincode, str } from '../organizations/organizations.schema.js';

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const CLIENT_TYPES = ['INDIVIDUAL', 'PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'HUF', 'TRUST', 'OTHER'];
const pan = str(10).toUpperCase().regex(PAN_REGEX, 'Enter a valid PAN (e.g. ABCDE1234F)');

const fields = {
  clientType: z.enum(CLIENT_TYPES),
  name: str(200).min(2, 'Client name is required'),
  contactPerson: opt(str(150)),
  email: opt(email),
  phone: opt(phone),
  altPhone: opt(phone),
  pan: opt(pan),
  gstin: opt(gstin),
  addressLine1: opt(str(200)),
  addressLine2: opt(str(200)),
  city: opt(str(100)),
  state: opt(str(100)),
  pincode: opt(pincode),
  notes: opt(str(1000)),
};

const createClientBody = z.strictObject({ ...fields, createPortalLogin: z.boolean().optional().default(false) });
const updateClientBody = z.strictObject(fields).partial();
const listClientsQuery = z.strictObject({ ...listQuery, status: z.enum(['ACTIVE', 'INACTIVE']).optional(), clientType: z.enum(CLIENT_TYPES).optional() });
const idParam = z.strictObject({ id: z.uuid() });

export { PAN_REGEX, CLIENT_TYPES, createClientBody, updateClientBody, listClientsQuery, idParam };
