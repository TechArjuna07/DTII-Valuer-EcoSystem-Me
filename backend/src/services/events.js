import { EventEmitter } from 'node:events';
import { logger } from '../config/logger.js';

/**
 * In-process domain event bus. Services emit events AFTER their transaction commits; listeners
 * (notifications, e-mail, signature sync…) react without the business modules depending on them.
 * Listener failures are logged and never propagate to the request.
 *
 *   case.created        { firmId, caseId, actorId }
 *   case.transitioned   { firmId, caseId, action, from, to, actorId, remarks }
 *   case.assigned       { firmId, caseId, stage, employeeId, actorId }
 *   document.uploaded   { firmId, caseId, documentId, versionId, folder, actorId }
 *   document.requested  { firmId, caseId, requestId, actorId }
 */
const bus = new EventEmitter();
bus.setMaxListeners(50);

function emit(event, payload) {
  for (const listener of bus.listeners(event)) {
    Promise.resolve()
      .then(() => listener(payload))
      .catch((e) => logger.error({ event, err: e.message }, 'Event listener failed'));
  }
}

const on = (event, listener) => bus.on(event, listener);

export { emit, on };
