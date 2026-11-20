-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'QUERY');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('VALUER', 'CLIENT');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('PENDING', 'SIGNED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SignatureVerification" AS ENUM ('UNVERIFIED', 'VERIFIED', 'INVALID');

-- CreateTable
CREATE TABLE "client_approvals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "report_version_id" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comments" VARCHAR(3000),
    "client_user_id" UUID NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(400),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_signatures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "source_version_id" UUID NOT NULL,
    "signed_version_id" UUID,
    "report_version_id" UUID,
    "signer_user_id" UUID NOT NULL,
    "signer_role" "SignerRole" NOT NULL,
    "signer_name" VARCHAR(150) NOT NULL,
    "signer_email" CITEXT NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "provider_ref" VARCHAR(120),
    "status" "SignatureStatus" NOT NULL DEFAULT 'PENDING',
    "document_sha256" VARCHAR(64) NOT NULL,
    "signed_sha256" VARCHAR(64),
    "cert_subject" VARCHAR(400),
    "cert_issuer" VARCHAR(400),
    "cert_serial" VARCHAR(120),
    "cert_valid_from" TIMESTAMPTZ(3),
    "cert_valid_to" TIMESTAMPTZ(3),
    "signature_algorithm" VARCHAR(60),
    "signature_value" TEXT,
    "verification_status" "SignatureVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "verification_detail" JSONB NOT NULL DEFAULT '{}',
    "legally_valid" BOOLEAN NOT NULL DEFAULT false,
    "consent_text" VARCHAR(1000) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(400),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "last_synced_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "digital_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_approvals_case_id_created_at_idx" ON "client_approvals"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "digital_signatures_case_id_signer_role_idx" ON "digital_signatures"("case_id", "signer_role");

-- CreateIndex
CREATE INDEX "digital_signatures_status_provider_idx" ON "digital_signatures"("status", "provider");

-- CreateIndex
CREATE INDEX "digital_signatures_source_version_id_idx" ON "digital_signatures"("source_version_id");

-- AddForeignKey
ALTER TABLE "client_approvals" ADD CONSTRAINT "client_approvals_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_signatures" ADD CONSTRAINT "digital_signatures_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════ Hand-written SQL ═══════════════════════════
CREATE TRIGGER "client_approvals_append_only" BEFORE UPDATE OR DELETE ON "client_approvals" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "digital_signatures_no_delete" BEFORE DELETE ON "digital_signatures" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

-- Once SIGNED, a signature record is frozen (only verification metadata may be refreshed).
CREATE FUNCTION "freeze_signed_signature"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'SIGNED' AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."document_sha256" IS DISTINCT FROM OLD."document_sha256"
     OR NEW."signed_sha256" IS DISTINCT FROM OLD."signed_sha256" OR NEW."signature_value" IS DISTINCT FROM OLD."signature_value"
     OR NEW."signer_user_id" IS DISTINCT FROM OLD."signer_user_id" OR NEW."signed_at" IS DISTINCT FROM OLD."signed_at"
     OR NEW."signed_version_id" IS DISTINCT FROM OLD."signed_version_id") THEN
    RAISE EXCEPTION 'digital_signatures: a completed signature is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "digital_signatures_freeze" BEFORE UPDATE ON "digital_signatures" FOR EACH ROW EXECUTE FUNCTION "freeze_signed_signature"();
ALTER TABLE "digital_signatures" ADD CONSTRAINT "digital_signatures_sha_format" CHECK ("document_sha256" ~ '^[0-9a-f]{64}$');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valuers_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "client_approvals" FROM valuers_app;
    REVOKE DELETE, TRUNCATE ON "digital_signatures" FROM valuers_app;
  END IF;
END $$;
