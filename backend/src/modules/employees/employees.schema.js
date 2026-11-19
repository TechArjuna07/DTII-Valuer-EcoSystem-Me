import { z } from 'zod';
import { listQuery } from '../../utils/pagination.js';
import { ROLES } from '../../config/rbac.js';
import { email, opt, phone, str } from '../organizations/organizations.schema.js';

/** Roles a firm can grant to employees (never SUPER_ADMIN; CLIENT is granted via client portal access). */
const STAFF_ROLE_CODES = [ROLES.FIRM_ADMIN, ROLES.MARKETING, ROLES.FIELD_OFFICER, ROLES.JUNIOR_REVIEWER, ROLES.SENIOR_REVIEWER];
const roles = z.array(z.enum(STAFF_ROLE_CODES)).min(1, 'Select at least one role').max(5).transform((r) => [...new Set(r)]);

const profile = {
  designation: opt(str(100)),
  department: opt(str(100)),
  registrationNo: opt(str(64)),
  dateOfJoining: opt(z.coerce.date()),
};

const createEmployeeBody = z.strictObject({ fullName: str(150).min(2, 'Name is required'), email, phone: opt(phone), roles, ...profile });
const updateEmployeeBody = z.strictObject({ fullName: str(150).min(2).optional(), phone: opt(phone), roles: roles.optional(), ...profile });
const listEmployeesQuery = z.strictObject({ ...listQuery, role: z.enum(STAFF_ROLE_CODES).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
const idParam = z.strictObject({ id: z.uuid() });

export { STAFF_ROLE_CODES, createEmployeeBody, updateEmployeeBody, listEmployeesQuery, idParam };
