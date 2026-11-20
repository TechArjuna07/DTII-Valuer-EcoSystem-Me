import { z } from 'zod';
import { listQuery } from '../../utils/pagination.js';
import { ALL_STATUSES, STATUS_GROUPS } from '../workflow/workflow.definition.js';
import { opt, str } from '../organizations/organizations.schema.js';

const money = z.coerce.number().min(0).max(1e13);
const date = z.coerce.date();

const caseFields = {
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).optional(),
  loanType: opt(str(80)),
  loanReference: opt(str(80)),
  loanAmount: opt(money),
  propertyAddress: opt(str(500)),
  propertyCity: opt(str(100)),
  description: opt(str(1000)),
  receivedOn: opt(date),
  dueDate: opt(date),
};

const createCaseBody = z.strictObject({
  clientId: z.uuid(),
  bankId: z.uuid(),
  categoryId: z.uuid(),
  /** Defaults to the current financial year. */
  financialYearId: z.uuid().optional(),
  ...caseFields,
  fieldOfficerId: z.uuid().optional(),
  marketingEmployeeId: z.uuid().optional(),
});

const updateCaseBody = z.strictObject(caseFields);

const listCasesQuery = z.strictObject({
  ...listQuery,
  status: z.enum(ALL_STATUSES).optional(),
  statusGroup: z.enum(Object.keys(STATUS_GROUPS)).optional(),
  clientId: z.uuid().optional(),
  bankId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  financialYearId: z.uuid().optional(),
  assignedToMe: z.enum(['true', 'false']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  awaitingDocuments: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'oldest', 'due']).optional(),
});

const assignBody = z.strictObject({ stage: z.enum(['MARKETING', 'FIELD', 'JUNIOR', 'SENIOR']), employeeId: z.uuid() });
const transitionBody = z.strictObject({ action: z.string().max(60).regex(/^[A-Z_]+$/), remarks: opt(str(1000)) });
const idParam = z.strictObject({ id: z.uuid() });

export { createCaseBody, updateCaseBody, listCasesQuery, assignBody, transitionBody, idParam };
