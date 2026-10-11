-- Durable, human-reviewed account recovery. The records below are deliberately
-- separate from Better Auth's ephemeral verification records so recovery holds
-- and security events survive normal OTP cleanup.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountRecoveryStatus') THEN
    CREATE TYPE "AccountRecoveryStatus" AS ENUM ('PENDING_REVIEW', 'NEEDS_INFO', 'REJECTED', 'APPROVED', 'CANCELLED', 'PROCESSING', 'COMPLETED', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountRecoveryChannel') THEN
    CREATE TYPE "AccountRecoveryChannel" AS ENUM ('EMAIL', 'PHONE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountRecoveryFactor') THEN
    CREATE TYPE "AccountRecoveryFactor" AS ENUM ('EMAIL', 'PHONE', 'OAUTH', 'PASSKEY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountRecoveryChallengePurpose') THEN
    CREATE TYPE "AccountRecoveryChallengePurpose" AS ENUM ('RECOVERY_DESTINATION', 'FACTOR_LINK');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountSecurityEventType') THEN
    CREATE TYPE "AccountSecurityEventType" AS ENUM ('FACTOR_LINKED', 'FACTOR_LINK_REJECTED', 'RECOVERY_REQUESTED', 'RECOVERY_APPROVED', 'RECOVERY_CANCELLED', 'RECOVERY_COMPLETED', 'PASSWORDS_PURGED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "account_recovery_challenges" (
  "id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "destination_hash" TEXT NOT NULL,
  "channel" "AccountRecoveryChannel" NOT NULL,
  "purpose" "AccountRecoveryChallengePurpose" NOT NULL,
  "code_hash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "verified_at" TIMESTAMP(3),
  "consumed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_recovery_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "account_recovery_requests" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "lookup_hash" TEXT NOT NULL,
  "destination_channel" "AccountRecoveryChannel" NOT NULL,
  "destination_value" TEXT NOT NULL,
  "destination_hash" TEXT NOT NULL,
  "receipt_token_hash" TEXT NOT NULL,
  "challenge_id" TEXT NOT NULL,
  "explanation" TEXT,
  "status" "AccountRecoveryStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewer_id" TEXT,
  "reviewer_note" TEXT,
  "retire_factors" "AccountRecoveryFactor"[] NOT NULL DEFAULT ARRAY[]::"AccountRecoveryFactor"[],
  "approved_at" TIMESTAMP(3),
  "release_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_recovery_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "account_security_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "request_id" TEXT,
  "actor_user_id" TEXT,
  "type" "AccountSecurityEventType" NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_security_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "account_recovery_challenges_token_hash_key" ON "account_recovery_challenges"("token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "account_recovery_requests_receipt_token_hash_key" ON "account_recovery_requests"("receipt_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "account_recovery_requests_challenge_id_key" ON "account_recovery_requests"("challenge_id");
CREATE INDEX IF NOT EXISTS "account_recovery_challenges_destination_idx" ON "account_recovery_challenges"("destination_hash", "purpose");
CREATE INDEX IF NOT EXISTS "account_recovery_challenges_expiry_idx" ON "account_recovery_challenges"("expires_at");
CREATE INDEX IF NOT EXISTS "account_recovery_requests_due_idx" ON "account_recovery_requests"("status", "release_at");
CREATE INDEX IF NOT EXISTS "account_recovery_requests_user_idx" ON "account_recovery_requests"("user_id");
CREATE INDEX IF NOT EXISTS "account_recovery_requests_reviewer_idx" ON "account_recovery_requests"("reviewer_id");
CREATE INDEX IF NOT EXISTS "account_recovery_requests_lookup_idx" ON "account_recovery_requests"("lookup_hash");
CREATE INDEX IF NOT EXISTS "account_security_events_user_idx" ON "account_security_events"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "account_security_events_request_idx" ON "account_security_events"("request_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_recovery_requests_user_id_fkey') THEN
    ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_recovery_requests_reviewer_id_fkey') THEN
    ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_recovery_requests_challenge_id_fkey') THEN
    ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "account_recovery_challenges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_security_events_user_id_fkey') THEN
    ALTER TABLE "account_security_events" ADD CONSTRAINT "account_security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_security_events_request_id_fkey') THEN
    ALTER TABLE "account_security_events" ADD CONSTRAINT "account_security_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "account_recovery_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Password authentication is permanently retired. Keep the nullable column
-- during the beta transition for Better Auth compatibility, but eliminate all
-- legacy credential material atomically and idempotently.
UPDATE "accounts"
SET "password" = NULL
WHERE "password" IS NOT NULL;
