-- Club-scoped marketplace: link a listing to a club and control its reach.
-- visibility: 'PUBLIC' (also shows in the global marketplace) | 'CLUB_ONLY'
-- (visible only to members of the club).

-- AlterTable
ALTER TABLE "marketplace_listings" ADD COLUMN "club_id" TEXT;
ALTER TABLE "marketplace_listings" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PUBLIC';

-- CreateIndex
CREATE INDEX "listings_club_idx" ON "marketplace_listings"("club_id", "status");

-- AddForeignKey
ALTER TABLE "marketplace_listings"
  ADD CONSTRAINT "marketplace_listings_club_id_fkey"
  FOREIGN KEY ("club_id") REFERENCES "clubs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
