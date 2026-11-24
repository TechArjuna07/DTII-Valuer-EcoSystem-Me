import { Router } from 'express';
import health from './modules/health/health.routes.js';
import auth from './modules/auth/auth.routes.js';
import platform from './modules/organizations/organizations.routes.js';
import employees from './modules/employees/employees.routes.js';
import clients from './modules/clients/clients.routes.js';
import firm from './modules/firm/firm.routes.js';
import masters from './modules/masters/masters.routes.js';
import cases from './modules/cases/cases.routes.js';
import documents from './modules/documents/documents.routes.js';
import files from './modules/documents/files.routes.js';
import inspections from './modules/inspections/inspections.routes.js';
import valuations from './modules/valuations/valuations.routes.js';
import approvals from './modules/approvals/approvals.routes.js';
import portal from './modules/portal/portal.routes.js';
import notifications from './modules/notifications/notifications.routes.js';
import dashboard from './modules/dashboard/dashboard.routes.js';
import asr from './modules/asr/asr.routes.js';

/** /api/v1 router. Each module mounts its own router here. */
const v1 = Router();

/** [mount path ('' = root), router] — also read by the OpenAPI generator to document every endpoint. */
const MOUNTS = [
  ['/health', health],
  ['/auth', auth],
  ['/platform', platform],
  ['/firm', firm],
  ['/employees', employees],
  ['/clients', clients],
  ['/masters', masters],
  ['/files', files],
  ['', documents],
  ['', inspections],
  ['', valuations],
  ['', approvals],
  ['', portal],
  ['', notifications],
  ['', dashboard],
  ['/cases', cases],
  ['/asr', asr],
];
for (const [path, router] of MOUNTS) (path ? v1.use(path, router) : v1.use(router));

export { v1, MOUNTS };
