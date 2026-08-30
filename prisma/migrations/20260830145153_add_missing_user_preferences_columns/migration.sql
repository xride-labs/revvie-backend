-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "allow_dms_from" TEXT NOT NULL DEFAULT 'everyone',
ADD COLUMN     "allow_friend_requests_from" TEXT NOT NULL DEFAULT 'everyone',
ADD COLUMN     "notify_clubs" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_marketplace" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_rides" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_social" BOOLEAN NOT NULL DEFAULT true;
