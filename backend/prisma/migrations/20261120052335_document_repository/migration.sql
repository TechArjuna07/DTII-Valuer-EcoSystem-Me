-- CreateEnum
CREATE TYPE "CaseFolder" AS ENUM ('SOURCE_FILES', 'INSPECTION_DOCUMENTS', 'PROPERTY_PHOTOGRAPHS', 'PRELIMINARY_VALUATION', 'SENIOR_REVIEW', 'FINAL_VALUATION_REPORT', 'CLIENT_SIGNED_FILES', 'BANK_SUBMISSION', 'SANCTION_DOCUMENTS', 'DISBURSEMENT_DOCUMENTS');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('INTERNAL', 'CLIENT');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "UploadSource" AS ENUM ('STAFF', 'CLIENT', 'SYSTEM', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "DocumentRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "case_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "folder" "CaseFolder" NOT NULL,
    "document_type_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'INTERNAL',
    "current_version_id" UUID,
    "version_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by_id" UUID,
    "archive_reason" VARCHAR(500),

    CONSTRAINT "case_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "upload_source" "UploadSource" NOT NULL DEFAULT 'STAFF',
    "uploaded_by_id" UUID,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "document_type_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "requested_from" VARCHAR(20) NOT NULL DEFAULT 'CLIENT',
    "status" "DocumentRequestStatus" NOT NULL DEFAULT 'OPEN',
    "due_date" DATE,
    "requested_by_id" UUID NOT NULL,
    "fulfilled_document_id" UUID,
    "fulfilled_by_id" UUID,
    "fulfilled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_documents_case_id_folder_idx" ON "case_documents"("case_id", "folder");

-- CreateIndex
CREATE UNIQUE INDEX "case_documents_firm_id_id_key" ON "case_documents"("firm_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_storage_key_key" ON "document_versions"("storage_key");

-- CreateIndex
CREATE INDEX "document_versions_firm_id_created_at_idx" ON "document_versions"("firm_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");

-- CreateIndex
CREATE INDEX "document_requests_case_id_status_idx" ON "document_requests"("case_id", "status");

-- AddForeignKey
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_firm_id_document_id_fkey" FOREIGN KEY ("firm_id", "document_id") REFERENCES "case_documents"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════ Hand-written SQL ═══════════════════════════
-- Versions are immutable: content identity can never change and rows are never deleted.
CREATE FUNCTION "forbid_version_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."storage_key" IS DISTINCT FROM OLD."storage_key" OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
     OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes" OR NEW."document_id" IS DISTINCT FROM OLD."document_id"
     OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."mime_type" IS DISTINCT FROM OLD."mime_type" THEN
    RAISE EXCEPTION 'document_versions content is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "document_versions_immutable" BEFORE UPDATE ON "document_versions" FOR EACH ROW EXECUTE FUNCTION "forbid_version_change"();
CREATE TRIGGER "document_versions_no_delete" BEFORE DELETE ON "document_versions" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "case_documents_no_delete" BEFORE DELETE ON "case_documents" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_size_positive" CHECK ("size_bytes" > 0);
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_from" CHECK ("requested_from" IN ('CLIENT', 'BANK', 'INTERNAL'));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valuers_app') THEN
    REVOKE DELETE, TRUNCATE ON "document_versions", "case_documents" FROM valuers_app;
  END IF;
END $$;
