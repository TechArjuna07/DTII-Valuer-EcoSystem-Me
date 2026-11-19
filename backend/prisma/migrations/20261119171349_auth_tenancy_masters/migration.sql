-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('INDIVIDUAL', 'PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'HUF', 'TRUST', 'OTHER');

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "replaced_by_id" UUID;

-- CreateTable
CREATE TABLE "firm_sequences" (
    "firm_id" UUID NOT NULL,
    "entity" VARCHAR(20) NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firm_sequences_pkey" PRIMARY KEY ("firm_id","entity")
);

-- CreateTable
CREATE TABLE "employee_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_code" VARCHAR(20) NOT NULL,
    "designation" VARCHAR(100),
    "department" VARCHAR(100),
    "registration_no" VARCHAR(64),
    "date_of_joining" DATE,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "client_code" VARCHAR(20) NOT NULL,
    "client_type" "ClientType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "contact_person" VARCHAR(150),
    "email" CITEXT,
    "phone" VARCHAR(20),
    "alt_phone" VARCHAR(20),
    "pan_enc" BYTEA,
    "pan_hmac" VARCHAR(64),
    "pan_last4" VARCHAR(4),
    "gstin" VARCHAR(15),
    "address_line1" VARCHAR(200),
    "address_line2" VARCHAR(200),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "pincode" VARCHAR(10),
    "notes" VARCHAR(1000),
    "user_id" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_profiles_firm_id_status_idx" ON "employee_profiles"("firm_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_firm_id_id_key" ON "employee_profiles"("firm_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_firm_id_user_id_key" ON "employee_profiles"("firm_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_firm_id_employee_code_key" ON "employee_profiles"("firm_id", "employee_code");

-- CreateIndex
CREATE INDEX "clients_firm_id_status_idx" ON "clients"("firm_id", "status");

-- CreateIndex
CREATE INDEX "clients_firm_id_name_idx" ON "clients"("firm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_firm_id_id_key" ON "clients"("firm_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_firm_id_client_code_key" ON "clients"("firm_id", "client_code");

-- CreateIndex
CREATE UNIQUE INDEX "clients_firm_id_pan_hmac_key" ON "clients"("firm_id", "pan_hmac");

-- CreateIndex
CREATE UNIQUE INDEX "clients_firm_id_user_id_key" ON "clients"("firm_id", "user_id");

-- AddForeignKey
ALTER TABLE "firm_sequences" ADD CONSTRAINT "firm_sequences_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════ Hand-written SQL ═══════════════════════════
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_code_format" CHECK ("employee_code" ~ '^EMP-[0-9]{6,}$');
ALTER TABLE "clients" ADD CONSTRAINT "clients_code_format" CHECK ("client_code" ~ '^CLT-[0-9]{6,}$');
ALTER TABLE "clients" ADD CONSTRAINT "clients_pan_consistency" CHECK (("pan_enc" IS NULL) = ("pan_hmac" IS NULL) AND ("pan_hmac" IS NULL) = ("pan_last4" IS NULL));
ALTER TABLE "firm_sequences" ADD CONSTRAINT "firm_sequences_nonneg" CHECK ("last_value" >= 0);
