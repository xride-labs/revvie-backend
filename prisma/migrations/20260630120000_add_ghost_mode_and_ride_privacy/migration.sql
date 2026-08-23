-- Captures schema changes that were made to schema.prisma WITHOUT a migration,
-- which left production missing these columns (every User query — incl. login —
-- was throwing P2022 ColumnNotFound). Additive + safe (new enum, new columns
-- with defaults, default-value tweaks).

-- CreateEnum
CREATE TYPE "RidePrivacyLevel" AS ENUM ('PUBLIC', 'FRIENDS_ONLY', 'INCOGNITO');

-- AlterTable
ALTER TABLE "admin_settings" ALTER COLUMN "site_name" SET DEFAULT 'Revvie',
ALTER COLUMN "site_url" SET DEFAULT 'https://revvie.app',
ALTER COLUMN "support_email" SET DEFAULT 'support@revvie.app',
ALTER COLUMN "from_email" SET DEFAULT 'noreply@revvie.app',
ALTER COLUMN "from_name" SET DEFAULT 'Revvie',
ALTER COLUMN "welcome_email_subject" SET DEFAULT 'Welcome to Revvie!',
ALTER COLUMN "welcome_email_body" SET DEFAULT 'Hi {{name}}, Welcome to Revvie!';

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "privacy_level" "RidePrivacyLevel" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ghost_mode_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ghost_mode_since" TIMESTAMP(3);
