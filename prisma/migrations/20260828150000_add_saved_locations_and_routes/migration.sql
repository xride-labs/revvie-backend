-- CreateEnum
CREATE TYPE "SavedLocationType" AS ENUM ('HOME', 'WORK', 'VIEWPOINT', 'MEETUP', 'GAS_STATION', 'FAVORITE', 'OTHER');

-- CreateTable
CREATE TABLE "saved_locations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "type" "SavedLocationType" NOT NULL DEFAULT 'FAVORITE',
    "icon" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_routes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ride_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_location" TEXT NOT NULL,
    "start_lat" DOUBLE PRECISION NOT NULL,
    "start_lng" DOUBLE PRECISION NOT NULL,
    "end_location" TEXT,
    "end_lat" DOUBLE PRECISION,
    "end_lng" DOUBLE PRECISION,
    "waypoints" JSONB,
    "route_data" TEXT,
    "distance" DOUBLE PRECISION,
    "duration" INTEGER,
    "is_favorite" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_locations_user_idx" ON "saved_locations"("user_id");

-- CreateIndex
CREATE INDEX "saved_routes_user_idx" ON "saved_routes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_routes_user_ride_unique" ON "saved_routes"("user_id", "ride_id");

-- AddForeignKey
ALTER TABLE "saved_locations" ADD CONSTRAINT "saved_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_routes" ADD CONSTRAINT "saved_routes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_routes" ADD CONSTRAINT "saved_routes_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;
