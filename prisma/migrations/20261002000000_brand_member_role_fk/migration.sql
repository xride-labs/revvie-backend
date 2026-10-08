-- Migrate BrandMember.role (BrandMemberRole enum) to role_id FK with backfill.
-- Step 1: add the nullable FK column.
ALTER TABLE "brand_members" ADD COLUMN "role_id" TEXT;

-- Step 2: backfill enum -> BUSINESS system role id BEFORE dropping the column.
-- Style mirrors migrate-production-rbac.ts (UPDATE ... WHERE role::text = ...).
UPDATE "brand_members" bm
SET "role_id" = r."id"
FROM "roles" r
WHERE bm."role"::text = 'OWNER'
  AND bm."role_id" IS NULL
  AND r."slug" = 'owner' AND r."scope" = 'BUSINESS' AND r."scope_id" IS NULL;

UPDATE "brand_members" bm
SET "role_id" = r."id"
FROM "roles" r
WHERE bm."role"::text = 'ADMIN'
  AND bm."role_id" IS NULL
  AND r."slug" = 'admin' AND r."scope" = 'BUSINESS' AND r."scope_id" IS NULL;

UPDATE "brand_members" bm
SET "role_id" = r."id"
FROM "roles" r
WHERE bm."role"::text = 'MODERATOR'
  AND bm."role_id" IS NULL
  AND r."slug" = 'moderator' AND r."scope" = 'BUSINESS' AND r."scope_id" IS NULL;

UPDATE "brand_members" bm
SET "role_id" = r."id"
FROM "roles" r
WHERE bm."role"::text = 'MEMBER'
  AND bm."role_id" IS NULL
  AND r."slug" = 'member' AND r."scope" = 'BUSINESS' AND r."scope_id" IS NULL;

-- Step 3: fail loudly on anything unmapped (unknown future enum value or
-- missing BUSINESS seed row) instead of silently defaulting.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "brand_members" WHERE "role_id" IS NULL) THEN
    RAISE EXCEPTION 'brand_members backfill incomplete: % row(s) still have NULL role_id',
      (SELECT COUNT(*) FROM "brand_members" WHERE "role_id" IS NULL);
  END IF;
END $$;

-- Step 4: enforce NOT NULL, drop the legacy enum column and type.
ALTER TABLE "brand_members" ALTER COLUMN "role_id" SET NOT NULL;
ALTER TABLE "brand_members" DROP COLUMN "role";
DROP TYPE "BrandMemberRole";

-- Step 5: index + FK (mirrors club_members_role_idx / club_members_role_id_fkey).
CREATE INDEX "brand_members_role_idx" ON "brand_members"("role_id");
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
