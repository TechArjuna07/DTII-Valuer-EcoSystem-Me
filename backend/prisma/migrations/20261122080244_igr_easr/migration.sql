-- CreateEnum
CREATE TYPE "AsrAreaType" AS ENUM ('URBAN', 'INFLUENCE', 'RURAL', 'NONE');

-- CreateEnum
CREATE TYPE "AsrFetchStatus" AS ENUM ('PENDING', 'FETCHING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "asr_districts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "gov_code" INTEGER,
    "talukas_fetched_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asr_districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asr_talukas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district_id" UUID NOT NULL,
    "gov_code" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "villages_fetched_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asr_talukas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asr_villages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "taluka_id" UUID NOT NULL,
    "gov_code" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asr_villages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asr_years" (
    "gov_code" INTEGER NOT NULL,
    "label" VARCHAR(20) NOT NULL,
    "start_year" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asr_years_pkey" PRIMARY KEY ("gov_code")
);

-- CreateTable
CREATE TABLE "asr_rate_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "village_id" UUID NOT NULL,
    "year_code" INTEGER NOT NULL,
    "status" "AsrFetchStatus" NOT NULL DEFAULT 'PENDING',
    "area_type" "AsrAreaType",
    "vibhag_no" VARCHAR(40),
    "locations" JSONB NOT NULL DEFAULT '[]',
    "survey_numbers_status" "AsrFetchStatus" NOT NULL DEFAULT 'PENDING',
    "fetched_at" TIMESTAMPTZ(3),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asr_rate_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asr_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rate_set_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "location_code" INTEGER,
    "location_name" VARCHAR(300),
    "zone_code" VARCHAR(60),
    "zone_name" VARCHAR(600),
    "open_land" DECIMAL(16,2),
    "residential" DECIMAL(16,2),
    "office" DECIMAL(16,2),
    "shop" DECIMAL(16,2),
    "industrial" DECIMAL(16,2),
    "rate" DECIMAL(16,2),
    "assessment_type" VARCHAR(200),
    "assessment_range" VARCHAR(100),
    "unit" VARCHAR(40),
    "unit_code" VARCHAR(20),
    "grid_page" INTEGER,
    "grid_row" INTEGER,
    "survey_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "survey_numbers_fetched" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "asr_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asr_fetch_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(30) NOT NULL,
    "target" VARCHAR(200) NOT NULL,
    "rate_set_id" UUID,
    "ok" BOOLEAN NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL,
    "error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asr_fetch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asr_districts_key_key" ON "asr_districts"("key");

-- CreateIndex
CREATE UNIQUE INDEX "asr_talukas_district_id_gov_code_key" ON "asr_talukas"("district_id", "gov_code");

-- CreateIndex
CREATE UNIQUE INDEX "asr_villages_taluka_id_gov_code_key" ON "asr_villages"("taluka_id", "gov_code");

-- CreateIndex
CREATE UNIQUE INDEX "asr_years_label_key" ON "asr_years"("label");

-- CreateIndex
CREATE INDEX "asr_rate_sets_status_idx" ON "asr_rate_sets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "asr_rate_sets_village_id_year_code_key" ON "asr_rate_sets"("village_id", "year_code");

-- CreateIndex
CREATE UNIQUE INDEX "asr_rates_rate_set_id_seq_key" ON "asr_rates"("rate_set_id", "seq");

-- CreateIndex
CREATE INDEX "asr_fetch_logs_created_at_idx" ON "asr_fetch_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "asr_talukas" ADD CONSTRAINT "asr_talukas_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "asr_districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asr_villages" ADD CONSTRAINT "asr_villages_taluka_id_fkey" FOREIGN KEY ("taluka_id") REFERENCES "asr_talukas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asr_rate_sets" ADD CONSTRAINT "asr_rate_sets_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "asr_villages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asr_rates" ADD CONSTRAINT "asr_rates_rate_set_id_fkey" FOREIGN KEY ("rate_set_id") REFERENCES "asr_rate_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Hand-written (not expressible in Prisma) ─────

-- A rate set belongs to a known eASR statement year.
ALTER TABLE "asr_rate_sets" ADD CONSTRAINT "asr_rate_sets_year_code_fkey" FOREIGN KEY ("year_code") REFERENCES "asr_years"("gov_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Survey-number lookups ("which zone is survey no. 140 in?") search the array column.
CREATE INDEX "asr_rates_survey_numbers_gin" ON "asr_rates" USING GIN ("survey_numbers");

-- Government rates are never negative.
ALTER TABLE "asr_rates" ADD CONSTRAINT "asr_rates_non_negative" CHECK (
  coalesce("open_land", 0) >= 0 AND coalesce("residential", 0) >= 0 AND coalesce("office", 0) >= 0
  AND coalesce("shop", 0) >= 0 AND coalesce("industrial", 0) >= 0 AND coalesce("rate", 0) >= 0
);

-- The fetch log is an append-only monitoring record.
CREATE TRIGGER "asr_fetch_logs_no_update" BEFORE UPDATE OR DELETE ON "asr_fetch_logs" FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
