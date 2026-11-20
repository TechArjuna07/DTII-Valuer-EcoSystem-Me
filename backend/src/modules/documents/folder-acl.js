import { ROLES } from '../../config/rbac.js';
import { FOLDER_CODES } from '../../config/folders.js';

/**
 * Folder-level access per role (docs/PHASE_1_ARCHITECTURE_AND_PLAN.md §4, "Document folders").
 * A user's access is the union over their roles, always within cases they can see (caseScope).
 * CLIENT_SIGNED_FILES is written only by the signature workflow (system); FINAL reports are mostly generated
 * by the valuation module, but the senior reviewer may also upload one.
 */
const [SRC, INS, PHO, PRE, REV, FIN, SIG, BNK, SAN, DIS] = FOLDER_CODES;

const READ = {
  [ROLES.FIRM_ADMIN]: FOLDER_CODES,
  [ROLES.MARKETING]: [SRC, FIN, SIG, BNK, SAN, DIS],
  [ROLES.FIELD_OFFICER]: [SRC, INS, PHO],
  [ROLES.JUNIOR_REVIEWER]: [SRC, INS, PHO, PRE],
  [ROLES.SENIOR_REVIEWER]: [SRC, INS, PHO, PRE, REV, FIN, SIG],
  [ROLES.CLIENT]: [SRC, FIN, SIG],
};

const WRITE = {
  [ROLES.FIRM_ADMIN]: [SRC, BNK, SAN, DIS],
  [ROLES.MARKETING]: [SRC, BNK, SAN, DIS],
  [ROLES.FIELD_OFFICER]: [INS, PHO],
  [ROLES.JUNIOR_REVIEWER]: [PRE],
  [ROLES.SENIOR_REVIEWER]: [REV, FIN],
  [ROLES.CLIENT]: [SRC],
};

function folderAccess(principal) {
  const read = new Set();
  const write = new Set();
  for (const r of principal.roles || []) {
    (READ[r] || []).forEach((f) => read.add(f));
    if (principal.permissions?.includes('document.upload')) (WRITE[r] || []).forEach((f) => write.add(f));
  }
  if (!principal.permissions?.includes('document.view')) read.clear();
  return { read, write };
}

/** Client portal users only see client-visible documents and their own uploads, even in readable folders. */
const isPortalClient = (p) => !!p.clientId && !p.employeeId;

export { folderAccess, isPortalClient, READ, WRITE };
