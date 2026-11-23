-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'GATEWAY', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'GATEWAY');

-- AlterEnum
ALTER TYPE "CaseStatus" ADD VALUE 'PAYMENT_PENDING';



-- CreateTable
CREATE TABLE "case_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "received_on" DATE NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "source" "PaymentSource" NOT NULL DEFAULT 'MANUAL',
    "reference" VARCHAR(120),
    "remarks" VARCHAR(1000),
    "gateway_ref" VARCHAR(120),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "case_payments_gateway_ref_key" ON "case_payments"("gateway_ref");

-- CreateIndex
CREATE INDEX "case_payments_case_id_idx" ON "case_payments"("case_id");

-- CreateIndex
CREATE INDEX "case_payments_firm_id_received_on_idx" ON "case_payments"("firm_id", "received_on");

-- AddForeignKey
ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───── Hand-written (not expressible in Prisma) ─────

-- A payment is always a positive amount.
ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_amount_positive" CHECK ("amount" > 0);

-- Payment records are evidence: never updated or deleted (corrections are new rows).
CREATE TRIGGER "case_payments_no_mutation" BEFORE UPDATE OR DELETE ON "case_payments" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
