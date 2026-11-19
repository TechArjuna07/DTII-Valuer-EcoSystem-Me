import { PERMISSION_DEFINITIONS, ROLE_DEFINITIONS, ROLES } from '../../src/config/rbac.js';

const has = (role, code) => PERMISSION_DEFINITIONS.find((p) => p.code === code).roles.includes(role);

describe('RBAC catalogue', () => {
  test('codes are unique and every referenced role exists', () => {
    const codes = PERMISSION_DEFINITIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    const roleCodes = new Set(ROLE_DEFINITIONS.map((r) => r.code));
    for (const p of PERMISSION_DEFINITIONS) for (const r of p.roles) expect(roleCodes.has(r)).toBe(true);
  });

  test('only Superadmin manages firms; Superadmin has no firm case access', () => {
    for (const p of PERMISSION_DEFINITIONS.filter((x) => x.code.startsWith('platform.'))) expect(p.roles).toEqual([ROLES.SUPER_ADMIN]);
    const saPerms = PERMISSION_DEFINITIONS.filter((p) => p.roles.includes(ROLES.SUPER_ADMIN)).map((p) => p.code);
    expect(saPerms.every((c) => c.startsWith('platform.'))).toBe(true);
  });

  test('maker-checker: preparing and approving valuations belong to different roles', () => {
    expect(has(ROLES.JUNIOR_REVIEWER, 'valuation.prepare')).toBe(true);
    expect(has(ROLES.JUNIOR_REVIEWER, 'valuation.approve')).toBe(false);
    expect(has(ROLES.SENIOR_REVIEWER, 'valuation.approve')).toBe(true);
    expect(has(ROLES.SENIOR_REVIEWER, 'valuation.prepare')).toBe(false);
  });

  test('clients get only portal-level permissions', () => {
    const clientPerms = PERMISSION_DEFINITIONS.filter((p) => p.roles.includes(ROLES.CLIENT)).map((p) => p.code).sort();
    expect(clientPerms).toEqual(['client.approve', 'document.upload', 'document.view', 'portal.access', 'signature.client']);
  });

  test('workflow-integrity permissions are marked critical', () => {
    for (const code of ['inspection.submit', 'valuation.approve', 'client.approve', 'signature.client', 'case.cancel']) {
      expect(PERMISSION_DEFINITIONS.find((p) => p.code === code).isCritical).toBe(true);
    }
  });
});
