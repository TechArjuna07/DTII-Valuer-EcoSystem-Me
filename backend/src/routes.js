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

v1.use('/health', health);
v1.use('/auth', auth);
v1.use('/platform', platform);
v1.use('/firm', firm);
v1.use('/employees', employees);
v1.use('/clients', clients);
v1.use('/masters', masters);
v1.use('/files', files);
v1.use(documents);
v1.use(inspections);
v1.use(valuations);
v1.use(approvals);
v1.use(portal);
v1.use(notifications);
v1.use(dashboard);
v1.use('/cases', cases);
v1.use('/asr', asr);

export { v1 };
