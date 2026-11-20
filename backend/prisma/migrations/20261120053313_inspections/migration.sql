-- CreateEnum
CREATE TYPE "PropertyCondition" AS ENUM ('EXCELLENT', 'GOOD', 'AVERAGE', 'POOR', 'DILAPIDATED');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('PROPERTY', 'LOCATION', 'LANDMARK', 'OTHER');

-- CreateTable
CREATE TABLE "property_details" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "fields_version" INTEGER NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_inspections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "officer_id" UUID NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "inspected_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "gps_lat" DECIMAL(10,7),
    "gps_lng" DECIMAL(10,7),
    "gps_accuracy_m" DECIMAL(8,2),
    "gps_captured_at" TIMESTAMPTZ(3),
    "gps_consent" BOOLEAN,
    "gps_declined_reason" VARCHAR(300),
    "property_type" VARCHAR(80),
    "property_address" VARCHAR(500),
    "land_area" DECIMAL(14,3),
    "land_area_unit" VARCHAR(20),
    "building_area" DECIMAL(14,3),
    "building_area_unit" VARCHAR(20),
    "condition" "PropertyCondition",
    "construction" JSONB NOT NULL DEFAULT '{}',
    "landmarks" JSONB NOT NULL DEFAULT '[]',
    "boundaries" JSONB NOT NULL DEFAULT '{}',
    "observations" JSONB NOT NULL DEFAULT '{}',
    "officer_remarks" VARCHAR(3000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firm_id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "kind" "PhotoKind" NOT NULL DEFAULT 'PROPERTY',
    "caption" VARCHAR(300),
    "gps_lat" DECIMAL(10,7),
    "gps_lng" DECIMAL(10,7),
    "captured_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_details_case_id_key" ON "property_details"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_details_firm_id_case_id_key" ON "property_details"("firm_id", "case_id");

-- CreateIndex
CREATE INDEX "property_inspections_firm_id_officer_id_status_idx" ON "property_inspections"("firm_id", "officer_id", "status");

-- CreateIndex
CREATE INDEX "property_inspections_firm_id_scheduled_at_idx" ON "property_inspections"("firm_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "property_inspections_firm_id_id_key" ON "property_inspections"("firm_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "property_inspections_case_id_round_key" ON "property_inspections"("case_id", "round");

-- CreateIndex
CREATE INDEX "inspection_photos_inspection_id_idx" ON "inspection_photos"("inspection_id");

-- AddForeignKey
ALTER TABLE "property_details" ADD CONSTRAINT "property_details_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_inspections" ADD CONSTRAINT "property_inspections_firm_id_case_id_fkey" FOREIGN KEY ("firm_id", "case_id") REFERENCES "valuation_cases"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_inspections" ADD CONSTRAINT "property_inspections_firm_id_officer_id_fkey" FOREIGN KEY ("firm_id", "officer_id") REFERENCES "employee_profiles"("firm_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_firm_id_inspection_id_fkey" FOREIGN KEY ("firm_id", "inspection_id") REFERENCES "property_inspections"("firm_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════ Hand-written SQL ═══════════════════════════
ALTER TABLE "property_inspections" ADD CONSTRAINT "property_inspections_gps_range" CHECK (("gps_lat" IS NULL OR ("gps_lat" BETWEEN -90 AND 90)) AND ("gps_lng" IS NULL OR ("gps_lng" BETWEEN -180 AND 180)));
ALTER TABLE "property_inspections" ADD CONSTRAINT "property_inspections_areas_nonneg" CHECK (("land_area" IS NULL OR "land_area" >= 0) AND ("building_area" IS NULL OR "building_area" >= 0));
ALTER TABLE "property_inspections" ADD CONSTRAINT "property_inspections_round_positive" CHECK ("round" > 0);
