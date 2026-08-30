-- AlterTable
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "issuer" TEXT;
UPDATE "accounts" SET "issuer" = 'local:' || "provider_id" WHERE "issuer" IS NULL;
