-- CreateEnum
CREATE TYPE "ReportStage" AS ENUM ('PRELIMINARY', 'FINAL');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'RETURNED', 'REJECTED');

-- CreateTable
CREATE TABLE "valuation_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "stage" "ReportStage" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "engine" VARCHAR(40) NOT NULL,
    "current_version_id" UUID,
    "version_count" INTEGER NOT NULL DEFAULT 0,
    "template_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "valuation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_report_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "calculation" JSONB NOT NULL,
    "market_value" DECIMAL(18,2) NOT NULL,
    "realisable_value" DECIMAL(18,2) NOT NULL,
    "distress_value" DECIMAL(18,2) NOT NULL,
    "guideline_value" DECIMAL(18,2),
    "insurable_value" DECIMAL(18,2),
    "summary" VARCHAR(5000),
    "change_note" VARCHAR(1000),
    "document_id" UUID,
    "document_version_id" UUID,
    "template_version_id" UUID,
    "verification_code" VARCHAR(40),
    "prepared_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_report_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "report_version_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comments" VARCHAR(3000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "bank_id" UUID,
    "category_id" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_version_id" UUID,
    "version_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_template_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "body_html" TEXT NOT NULL,
    "change_note" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "valuation_reports_firm_id_id_key" ON "valuation_reports"("firm_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_reports_case_id_stage_key" ON "valuation_reports"("case_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_report_versions_verification_code_key" ON "valuation_report_versions"("verification_code");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_report_versions_firm_id_id_key" ON "valuation_report_versions"("firm_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_report_versions_report_id_version_key" ON "valuation_report_versions"("report_id", "version");

-- CreateIndex
CREATE INDEX "report_reviews_report_version_id_idx" ON "report_reviews"("report_version_id");

-- CreateIndex
CREATE INDEX "report_templates_firm_id_bank_id_category_id_idx" ON "report_templates"("firm_id", "bank_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_firm_id_id_key" ON "report_templates"("firm_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "report_template_versions_template_id_version_key" ON "report_template_versions"("template_id", "version");

-- AddForeignKey
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_report_versions" ADD CONSTRAINT "valuation_report_versions_firm_id_report_id_fkey" FOREIGN KEY ("firm_id", "report_id") REFERENCES "valuation_reports"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_reviews" ADD CONSTRAINT "report_reviews_firm_id_report_version_id_fkey" FOREIGN KEY ("firm_id", "report_version_id") REFERENCES "valuation_report_versions"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_template_versions" ADD CONSTRAINT "report_template_versions_firm_id_template_id_fkey" FOREIGN KEY ("firm_id", "template_id") REFERENCES "report_templates"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════ Hand-written SQL ═══════════════════════════
-- Report versions, reviews and template versions are append-only.
CREATE TRIGGER "valuation_report_versions_append_only" BEFORE UPDATE OR DELETE ON "valuation_report_versions" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "report_reviews_append_only" BEFORE UPDATE OR DELETE ON "report_reviews" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "report_template_versions_append_only" BEFORE UPDATE OR DELETE ON "report_template_versions" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
ALTER TABLE "valuation_report_versions" ADD CONSTRAINT "valuation_report_versions_values_nonneg" CHECK ("market_value" >= 0 AND "realisable_value" >= 0 AND "distress_value" >= 0);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valuers_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "valuation_report_versions", "report_reviews", "report_template_versions" FROM valuers_app;
  END IF;
END $$;
