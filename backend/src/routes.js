import { Router } from 'express';
import health from './modules/health/health.routes.js';

/** /api/v1 router. Each module mounts its own router here. */
const v1 = Router();

v1.use('/health', health);

export { v1 };
