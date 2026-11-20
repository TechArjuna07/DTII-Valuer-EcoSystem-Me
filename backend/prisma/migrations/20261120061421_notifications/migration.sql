-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID,
    "recipient_id" UUID NOT NULL,
    "event" VARCHAR(60) NOT NULL,
    "case_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "link" VARCHAR(300),
    "read_at" TIMESTAMPTZ(3),
    "dedupe_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID,
    "notification_id" UUID,
    "to_masked" VARCHAR(120) NOT NULL,
    "to_hash" VARCHAR(64) NOT NULL,
    "template" VARCHAR(60) NOT NULL,
    "subject" VARCHAR(250) NOT NULL,
    "provider" VARCHAR(20),
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_message_id" VARCHAR(250),
    "error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "email_logs_firm_id_created_at_idx" ON "email_logs"("firm_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "email_logs_status_idx" ON "email_logs"("status");

-- Delivery logs are evidence: never deleted by the application.
CREATE TRIGGER "email_logs_no_delete" BEFORE DELETE ON "email_logs" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
