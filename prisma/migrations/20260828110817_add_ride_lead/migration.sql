-- Group ride lead: a nullable single FK on rides, not a per-participant
-- role enum, since a ride only ever has one lead at a time (no
-- cross-row uniqueness invariant to maintain). Unset means the API treats
-- the ride's creator as the lead until explicitly reassigned.

-- AlterTable
ALTER TABLE "rides" ADD COLUMN "lead_user_id" TEXT;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_lead_user_id_fkey" FOREIGN KEY ("lead_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
