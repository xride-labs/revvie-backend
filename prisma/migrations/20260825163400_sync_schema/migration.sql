-- AlterTable
ALTER TABLE "bikes" ADD COLUMN "bike_model_id" TEXT;

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo_url" TEXT,
    "description" TEXT,
    "origin_country" TEXT,
    "founded_year" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bike_models" (
    "id" TEXT NOT NULL,
    "manufacturer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_url" TEXT,
    "category" TEXT,
    "engine_cc" INTEGER,
    "start_year" INTEGER,
    "end_year" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bike_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_name_key" ON "manufacturers"("name");

-- CreateIndex
CREATE INDEX "bike_models_manufacturer_id_idx" ON "bike_models"("manufacturer_id");

-- CreateIndex
CREATE INDEX "bikes_bike_model_id_idx" ON "bikes"("bike_model_id");

-- AddForeignKey
ALTER TABLE "bikes" ADD CONSTRAINT "bikes_bike_model_id_fkey" FOREIGN KEY ("bike_model_id") REFERENCES "bike_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bike_models" ADD CONSTRAINT "bike_models_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
