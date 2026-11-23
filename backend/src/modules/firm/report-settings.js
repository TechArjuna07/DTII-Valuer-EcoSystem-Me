import { z } from 'zod';
import { prisma } from '../../database/prisma.js';
import { recordAudit } from '../../services/audit.service.js';

/**
 * Firm letterhead and billing details printed on bank-format valuation reports (stored in
 * organization_settings.branding.report — no secrets here; it is printed on every report).
 * Firm name, address, GSTIN, phone and e-mail come from the firm profile itself.
 */

const t = (max) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

const reportSettingsBody = z.strictObject({
  letterhead: z
    .strictObject({
      title: t(120), // e.g. "AMOL D. GOTMARE" (defaults to the firm name)
      qualifications: t(200), // "B.E. (Civil), M.Sc (R.E.V), M.I.E., D.PH., F.I.V."
      subtitle: t(150), // "Engineers & Valuation Consultants"
      designations: t(300), // "Consulting Civil Engg. * Govt. Regd. Valuer (CAT-I) * Approved Valuer * Chartered Engineer"
      empanelment: t(500), // "Chartered Engineer, Govt. Approved Valuer … L.NO.Cat-I/107/2009-10"
      pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN').optional().or(z.literal('').transform(() => undefined)),
      sacCode: t(10),
    })
    .default({}),
  billing: z
    .strictObject({
      invoicePrefix: t(30), // "MUM/JM" → MUM/JM/26-27/<case no.>
      gstRatePct: z.coerce.number().min(0).max(28).optional(),
      accountHolder: t(120),
      accountNumber: z.string().trim().regex(/^[0-9]{6,20}$/, 'Account number: 6–20 digits').optional().or(z.literal('').transform(() => undefined)),
      ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC').optional().or(z.literal('').transform(() => undefined)),
      bankBranch: t(200),
      upiId: z.string().trim().regex(/^[\w.-]{2,64}@[A-Za-z]{2,64}$/, 'Enter a valid UPI ID').optional().or(z.literal('').transform(() => undefined)),
    })
    .default({}),
});

const DEFAULTS = { letterhead: { sacCode: '997224' }, billing: { gstRatePct: 18 } };

async function getReportSettings(firmId) {
  const s = await prisma.organizationSettings.findUnique({ where: { firmId }, select: { branding: true } });
  const saved = s?.branding?.report ?? {};
  return { letterhead: { ...DEFAULTS.letterhead, ...(saved.letterhead ?? {}) }, billing: { ...DEFAULTS.billing, ...(saved.billing ?? {}) } };
}

async function updateReportSettings(principal, body, req) {
  await prisma.$transaction(async (tx) => {
    const s = await tx.organizationSettings.findUnique({ where: { firmId: principal.firmId }, select: { branding: true } });
    const branding = { ...(s?.branding ?? {}), report: body };
    await tx.organizationSettings.upsert({ where: { firmId: principal.firmId }, update: { branding, updatedById: principal.userId }, create: { firmId: principal.firmId, branding, updatedById: principal.userId } });
    await recordAudit({ action: 'REPORT_SETTINGS_UPDATED', principal, req, entityType: 'organization', entityId: principal.firmId, meta: { fields: [...Object.keys(body.letterhead), ...Object.keys(body.billing)] } }, tx);
  });
  return getReportSettings(principal.firmId);
}

export { reportSettingsBody, getReportSettings, updateReportSettings };
