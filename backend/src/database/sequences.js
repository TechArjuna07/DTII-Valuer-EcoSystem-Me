/**
 * Per-firm, human-readable codes: EMP-000001, CLT-000001.
 *
 * Concurrency: `INSERT … ON CONFLICT DO UPDATE … RETURNING` takes a row lock on the (firm, entity) counter.
 * Called inside the business transaction, concurrent creators queue on that lock, so codes are unique and
 * gap-free; if the transaction rolls back, the increment rolls back with it (the code was never used).
 * The same pattern generates Case IDs (per firm + financial year) in the cases module.
 */
const PREFIX = Object.freeze({ EMPLOYEE: 'EMP', CLIENT: 'CLT' });

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx  MUST be a transaction client
 * @param {string} firmId
 * @param {'EMPLOYEE'|'CLIENT'} entity
 */
async function nextFirmCode(tx, firmId, entity) {
  if (!PREFIX[entity]) throw new Error(`Unknown sequence entity ${entity}`);
  const rows = await tx.$queryRaw`
    INSERT INTO firm_sequences (firm_id, entity, last_value, updated_at)
    VALUES (${firmId}::uuid, ${entity}, 1, now())
    ON CONFLICT (firm_id, entity)
    DO UPDATE SET last_value = firm_sequences.last_value + 1, updated_at = now()
    RETURNING last_value`;
  return `${PREFIX[entity]}-${String(Number(rows[0].last_value)).padStart(6, '0')}`;
}

/** Next platform firm code: FIRM001, FIRM002, … (PostgreSQL sequence; never reused). */
async function nextFirmCodeForOrganization(tx) {
  const rows = await tx.$queryRaw`SELECT nextval('organization_code_seq')::bigint AS n`;
  return `FIRM${String(Number(rows[0].n)).padStart(3, '0')}`;
}

export { nextFirmCode, nextFirmCodeForOrganization };
