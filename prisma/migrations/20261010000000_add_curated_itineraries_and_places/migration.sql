-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ItineraryTheme') THEN
    CREATE TYPE "ItineraryTheme" AS ENUM ('NAVADURGAS', 'SEEMADURGAS', 'WATERBODIES', 'TREKS', 'HISTORICAL', 'COASTAL_DRIVES', 'MOTO_EVENTS', 'CHALLENGE_DOCKET');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DurationTier') THEN
    CREATE TYPE "DurationTier" AS ENUM ('HALF_DAY', 'FULL_DAY', 'WEEKEND', 'EXPEDITION_WEEK', 'EXPEDITION_15_DAYS', 'CUSTOM_DAYS');
  END IF;
END $$;

-- AlterTable places
ALTER TABLE "places"
  ADD COLUMN IF NOT EXISTS "rating" DOUBLE PRECISION NOT NULL DEFAULT 4.5,
  ADD COLUMN IF NOT EXISTS "rating_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "difficulty" TEXT,
  ADD COLUMN IF NOT EXISTS "corridor" TEXT,
  ADD COLUMN IF NOT EXISTS "region" TEXT NOT NULL DEFAULT 'KARNATAKA',
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "elevation" TEXT,
  ADD COLUMN IF NOT EXISTS "best_season" TEXT,
  ADD COLUMN IF NOT EXISTS "road_conditions" TEXT,
  ADD COLUMN IF NOT EXISTS "distance_from_blr" INTEGER,
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "image_url" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "is_curated" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "places_corridor_idx" ON "places"("corridor");
CREATE INDEX IF NOT EXISTS "places_rating_idx" ON "places"("rating");
CREATE INDEX IF NOT EXISTS "places_category_idx" ON "places"("category");

-- CreateTable curated_itineraries
CREATE TABLE IF NOT EXISTS "curated_itineraries" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "theme" "ItineraryTheme" NOT NULL,
    "duration_tier" "DurationTier" NOT NULL,
    "corridor" TEXT,
    "region" TEXT NOT NULL DEFAULT 'KARNATAKA',
    "distance_km" DOUBLE PRECISION NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "difficulty" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 4.8,
    "rating_count" INTEGER NOT NULL DEFAULT 1,
    "start_location_name" TEXT NOT NULL,
    "start_lat" DOUBLE PRECISION NOT NULL,
    "start_lng" DOUBLE PRECISION NOT NULL,
    "end_location_name" TEXT,
    "end_lat" DOUBLE PRECISION,
    "end_lng" DOUBLE PRECISION,
    "route_polyline" TEXT,
    "hero_image" TEXT,
    "gallery_images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "highlights" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curated_itineraries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "curated_itineraries_slug_key" ON "curated_itineraries"("slug");
CREATE INDEX IF NOT EXISTS "curated_itineraries_theme_idx" ON "curated_itineraries"("theme");
CREATE INDEX IF NOT EXISTS "curated_itineraries_duration_idx" ON "curated_itineraries"("duration_tier");
CREATE INDEX IF NOT EXISTS "curated_itineraries_corridor_idx" ON "curated_itineraries"("corridor");
CREATE INDEX IF NOT EXISTS "curated_itineraries_rating_idx" ON "curated_itineraries"("rating");

-- CreateTable curated_itinerary_waypoints
CREATE TABLE IF NOT EXISTS "curated_itinerary_waypoints" (
    "id" TEXT NOT NULL,
    "itinerary_id" TEXT NOT NULL,
    "place_id" TEXT,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "stop_type" TEXT NOT NULL DEFAULT 'STOP',
    "notes" TEXT,

    CONSTRAINT "curated_itinerary_waypoints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "curated_itinerary_waypoints_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "curated_itineraries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "curated_itinerary_waypoints_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "itinerary_waypoints_order_idx" ON "curated_itinerary_waypoints"("itinerary_id", "order");

-- AlterTable rides
ALTER TABLE "rides"
  ADD COLUMN IF NOT EXISTS "curated_itinerary_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rides_curated_itinerary_id_fkey'
  ) THEN
    ALTER TABLE "rides"
      ADD CONSTRAINT "rides_curated_itinerary_id_fkey"
      FOREIGN KEY ("curated_itinerary_id") REFERENCES "curated_itineraries"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "rides_curated_itinerary_idx" ON "rides"("curated_itinerary_id");
