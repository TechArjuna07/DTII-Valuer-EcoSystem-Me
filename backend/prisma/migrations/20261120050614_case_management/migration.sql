-- CreateEnum
CREATE TYPE "InstitutionType" AS ENUM ('BANK', 'NBFC', 'HFC', 'COOPERATIVE_BANK', 'OTHER');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('CASE_RECEIVED', 'INSPECTION_ASSIGNED', 'INSPECTION_IN_PROGRESS', 'INSPECTION_COMPLETED', 'PRELIMINARY_VALUATION_IN_PROGRESS', 'PRELIMINARY_SUBMITTED', 'FINAL_REVIEW_IN_PROGRESS', 'SENT_BACK_FOR_CORRECTION', 'FINAL_APPROVED', 'CLIENT_APPROVAL_PENDING', 'CLIENT_QUERY_RAISED', 'CLIENT_APPROVED', 'CLIENT_SIGNED', 'SUBMITTED_TO_BANK', 'LOAN_SANCTIONED', 'DISBURSED', 'CASE_COMPLETED', 'CASE_ON_HOLD', 'CASE_CANCELLED', 'CASE_REJECTED');

-- CreateEnum
CREATE TYPE "CasePriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AssignmentStage" AS ENUM ('MARKETING', 'FIELD', 'JUNIOR', 'SENIOR');

-- CreateTable
CREATE TABLE "banks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "institution_type" "InstitutionType" NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "short_code" VARCHAR(20) NOT NULL,
    "branch" VARCHAR(150),
    "ifsc" VARCHAR(11),
    "contact_person" VARCHAR(150),
    "email" CITEXT,
    "phone" VARCHAR(20),
    "address" VARCHAR(400),
    "requires_client_approval" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(400),
    "engine" VARCHAR(40) NOT NULL,
    "fields_version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "valuation_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_field_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "section" VARCHAR(80) NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "unit" VARCHAR(20),
    "help_text" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "default_folder" VARCHAR(40) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_counters" (
    "firm_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "case_counters_pkey" PRIMARY KEY ("firm_id","financial_year_id")
);

-- CreateTable
CREATE TABLE "valuation_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_number" VARCHAR(40) NOT NULL,
    "seq" INTEGER NOT NULL,
    "client_id" UUID NOT NULL,
    "bank_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'CASE_RECEIVED',
    "hold_from_status" "CaseStatus",
    "priority" "CasePriority" NOT NULL DEFAULT 'NORMAL',
    "loan_type" VARCHAR(80),
    "loan_reference" VARCHAR(80),
    "loan_amount" DECIMAL(18,2),
    "property_address" VARCHAR(500),
    "property_city" VARCHAR(100),
    "description" VARCHAR(1000),
    "received_on" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE,
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_overdue" BOOLEAN NOT NULL DEFAULT false,
    "awaiting_documents" BOOLEAN NOT NULL DEFAULT false,
    "closure_reason" VARCHAR(500),
    "closed_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "valuation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "stage" "AssignmentStage" NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" VARCHAR(200),

    CONSTRAINT "case_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "from_status" "CaseStatus",
    "to_status" "CaseStatus" NOT NULL,
    "actor_id" UUID,
    "actor_role" VARCHAR(40),
    "remarks" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "actor_id" UUID,
    "actor_role" VARCHAR(40),
    "prev_status" "CaseStatus",
    "new_status" "CaseStatus",
    "document_version_id" UUID,
    "ip" VARCHAR(64),
    "remarks" VARCHAR(1000),
    "meta" JSONB NOT NULL DEFAULT '{}',
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banks_firm_id_status_idx" ON "banks"("firm_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "banks_firm_id_id_key" ON "banks"("firm_id", "id");

-- CreateIndex
CREATE INDEX "valuation_categories_firm_id_active_idx" ON "valuation_categories"("firm_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "category_field_definitions_category_id_key_key" ON "category_field_definitions"("category_id", "key");

-- CreateIndex
CREATE INDEX "document_types_firm_id_active_idx" ON "document_types"("firm_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_cases_case_number_key" ON "valuation_cases"("case_number");

-- CreateIndex
CREATE INDEX "valuation_cases_firm_id_status_idx" ON "valuation_cases"("firm_id", "status");

-- CreateIndex
CREATE INDEX "valuation_cases_firm_id_client_id_idx" ON "valuation_cases"("firm_id", "client_id");

-- CreateIndex
CREATE INDEX "valuation_cases_firm_id_financial_year_id_idx" ON "valuation_cases"("firm_id", "financial_year_id");

-- CreateIndex
CREATE INDEX "valuation_cases_firm_id_bank_id_idx" ON "valuation_cases"("firm_id", "bank_id");

-- CreateIndex
CREATE INDEX "valuation_cases_firm_id_created_at_idx" ON "valuation_cases"("firm_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "valuation_cases_firm_id_id_key" ON "valuation_cases"("firm_id", "id");

-- CreateIndex
CREATE INDEX "case_assignments_firm_id_employee_id_ended_at_idx" ON "case_assignments"("firm_id", "employee_id", "ended_at");

-- CreateIndex
CREATE INDEX "case_assignments_case_id_stage_idx" ON "case_assignments"("case_id", "stage");

-- CreateIndex
CREATE INDEX "case_status_history_case_id_created_at_idx" ON "case_status_history"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "case_activities_case_id_created_at_idx" ON "case_activities"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "case_activities_firm_id_created_at_idx" ON "case_activities"("firm_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "banks" ADD CONSTRAINT "banks_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_categories" ADD CONSTRAINT "valuation_categories_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_field_definitions" ADD CONSTRAINT "category_field_definitions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "valuation_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_counters" ADD CONSTRAINT "case_counters_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_counters" ADD CONSTRAINT "case_counters_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_firm_id_client_id_fkey" FOREIGN KEY ("firm_id", "client_id") REFERENCES "clients"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_firm_id_bank_id_fkey" FOREIGN KEY ("firm_id", "bank_id") REFERENCES "banks"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "valuation_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_firm_id_employee_id_fkey" FOREIGN KEY ("firm_id", "employee_id") REFERENCES "employee_profiles"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_status_history" ADD CONSTRAINT "case_status_history_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_activities" ADD CONSTRAINT "case_activities_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════ Hand-written SQL ═══════════════════════════

-- Case ID: VAL-<FIRMCODE>-FY<yyyy>-<seq>, permanent once created.
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_number_format" CHECK ("case_number" ~ '^VAL-FIRM[0-9]{3,6}-FY[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_loan_amount_nonneg" CHECK ("loan_amount" IS NULL OR "loan_amount" >= 0);
ALTER TABLE "valuation_cases" ADD CONSTRAINT "valuation_cases_seq_positive" CHECK ("seq" > 0);

CREATE FUNCTION "forbid_case_identity_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."case_number" IS DISTINCT FROM OLD."case_number" OR NEW."seq" IS DISTINCT FROM OLD."seq"
     OR NEW."firm_id" IS DISTINCT FROM OLD."firm_id" OR NEW."financial_year_id" IS DISTINCT FROM OLD."financial_year_id" THEN
    RAISE EXCEPTION 'valuation_cases identity (case_number, seq, firm, financial year) is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "valuation_cases_identity_immutable" BEFORE UPDATE ON "valuation_cases"
  FOR EACH ROW EXECUTE FUNCTION "forbid_case_identity_change"();
CREATE TRIGGER "valuation_cases_no_delete" BEFORE DELETE ON "valuation_cases"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

-- One active assignment per case and stage.
CREATE UNIQUE INDEX "case_assignments_one_active_per_stage" ON "case_assignments" ("case_id", "stage") WHERE "ended_at" IS NULL;

-- Category / document type codes unique per firm, and among platform defaults.
CREATE UNIQUE INDEX "valuation_categories_platform_code" ON "valuation_categories" ("code") WHERE "firm_id" IS NULL;
CREATE UNIQUE INDEX "valuation_categories_firm_code" ON "valuation_categories" ("firm_id", "code") WHERE "firm_id" IS NOT NULL;
CREATE UNIQUE INDEX "document_types_platform_code" ON "document_types" ("code") WHERE "firm_id" IS NULL;
CREATE UNIQUE INDEX "document_types_firm_code" ON "document_types" ("firm_id", "code") WHERE "firm_id" IS NOT NULL;

ALTER TABLE "case_counters" ADD CONSTRAINT "case_counters_nonneg" CHECK ("last_value" >= 0);

-- Append-only case timelines.
CREATE TRIGGER "case_status_history_append_only" BEFORE UPDATE OR DELETE ON "case_status_history"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "case_activities_append_only" BEFORE UPDATE OR DELETE ON "case_activities"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "case_status_history_no_truncate" BEFORE TRUNCATE ON "case_status_history"
  FOR EACH STATEMENT EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "case_activities_no_truncate" BEFORE TRUNCATE ON "case_activities"
  FOR EACH STATEMENT EXECUTE FUNCTION "forbid_mutation"();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valuers_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "case_status_history", "case_activities" FROM valuers_app;
    REVOKE DELETE, TRUNCATE ON "valuation_cases" FROM valuers_app;
  END IF;
END $$;
