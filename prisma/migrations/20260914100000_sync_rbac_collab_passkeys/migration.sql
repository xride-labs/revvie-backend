-- Drop existing foreign keys if present so they can be recreated with ON UPDATE CASCADE
ALTER TABLE "club_members" DROP CONSTRAINT IF EXISTS "club_members_role_id_fkey";
ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_permission_id_fkey";
ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_role_id_fkey";
ALTER TABLE "user_role_assignments" DROP CONSTRAINT IF EXISTS "user_role_assignments_role_id_fkey";

-- AlterTable club_join_requests
ALTER TABLE "club_join_requests" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;
ALTER TABLE "club_join_requests" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);
ALTER TABLE "club_join_requests" ADD COLUMN IF NOT EXISTS "reviewed_by_id" TEXT;

-- AlterTable permissions
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable user_role_assignments
ALTER TABLE "user_role_assignments" ADD COLUMN IF NOT EXISTS "assigned_by_id" TEXT;

-- CreateTable passkeys
CREATE TABLE IF NOT EXISTS "passkeys" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "public_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "device_type" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "transports" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "aaguid" TEXT,

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "passkeys_user_id_idx" ON "passkeys"("user_id");
CREATE INDEX IF NOT EXISTS "passkeys_credential_id_idx" ON "passkeys"("credential_id");
CREATE INDEX IF NOT EXISTS "club_join_requests_club_status_idx" ON "club_join_requests"("club_id", "status");
CREATE INDEX IF NOT EXISTS "permissions_scope_idx" ON "permissions"("scope");
CREATE INDEX IF NOT EXISTS "permissions_category_idx" ON "permissions"("category");

-- AddForeignKey passkeys -> users
ALTER TABLE "passkeys" DROP CONSTRAINT IF EXISTS "passkeys_user_id_fkey";
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey role_permissions -> roles
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey role_permissions -> permissions
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey user_role_assignments -> roles
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey user_role_assignments -> users (assigned_by)
ALTER TABLE "user_role_assignments" DROP CONSTRAINT IF EXISTS "user_role_assignments_assigned_by_id_fkey";
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey club_members -> roles
ALTER TABLE "club_members" ADD CONSTRAINT "club_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey club_join_requests -> users (reviewed_by)
ALTER TABLE "club_join_requests" DROP CONSTRAINT IF EXISTS "club_join_requests_reviewed_by_id_fkey";
ALTER TABLE "club_join_requests" ADD CONSTRAINT "club_join_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
