-- CreateEnum
CREATE TYPE "SubmissionMode" AS ENUM ('DIGITAL', 'PHYSICAL', 'BOTH');

-- CreateEnum
CREATE TYPE "SanctionOutcome" AS ENUM ('SANCTIONED', 'DECLINED');

-- CreateTable
CREATE TABLE "bank_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "mode" "SubmissionMode" NOT NULL,
    "submitted_on" DATE NOT NULL,
    "submitted_to" VARCHAR(150),
    "ack_number" VARCHAR(80),
    "ack_document_id" UUID,
    "signed_version_id" UUID,
    "remarks" VARCHAR(1000),
    "submitted_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_sanctions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "outcome" "SanctionOutcome" NOT NULL,
    "amount" DECIMAL(18,2),
    "sanction_date" DATE NOT NULL,
    "reference_no" VARCHAR(80),
    "letter_document_id" UUID,
    "remarks" VARCHAR(1000),
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_disbursements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "tranche_no" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "disbursed_on" DATE NOT NULL,
    "reference_no" VARCHAR(80),
    "proof_document_id" UUID,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "remarks" VARCHAR(1000),
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_submissions_case_id_submitted_on_idx" ON "bank_submissions"("case_id", "submitted_on");

-- CreateIndex
CREATE UNIQUE INDEX "loan_sanctions_case_id_key" ON "loan_sanctions"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "loan_sanctions_firm_id_case_id_key" ON "loan_sanctions"("firm_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "loan_disbursements_case_id_tranche_no_key" ON "loan_disbursements"("case_id", "tranche_no");

-- AddForeignKey
ALTER TABLE "bank_submissions" ADD CONSTRAINT "bank_submissions_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_sanctions" ADD CONSTRAINT "loan_sanctions_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_disbursements" ADD CONSTRAINT "loan_disbursements_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════ Hand-written SQL ═══════════════════════════
-- Bank / loan records are financial evidence: append-only.
CREATE TRIGGER "bank_submissions_append_only" BEFORE UPDATE OR DELETE ON "bank_submissions" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "loan_sanctions_append_only" BEFORE UPDATE OR DELETE ON "loan_sanctions" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "loan_disbursements_append_only" BEFORE UPDATE OR DELETE ON "loan_disbursements" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
ALTER TABLE "loan_sanctions" ADD CONSTRAINT "loan_sanctions_amount" CHECK (("outcome" = 'SANCTIONED' AND "amount" > 0) OR ("outcome" = 'DECLINED'));
ALTER TABLE "loan_disbursements" ADD CONSTRAINT "loan_disbursements_amount_positive" CHECK ("amount" > 0 AND "tranche_no" > 0);
ALTER TABLE "bank_submissions" ADD CONSTRAINT "bank_submissions_evidence" CHECK ("ack_number" IS NOT NULL OR "ack_document_id" IS NOT NULL);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valuers_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "bank_submissions", "loan_sanctions", "loan_disbursements" FROM valuers_app;
  END IF;
END $$;
