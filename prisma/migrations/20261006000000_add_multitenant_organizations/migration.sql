-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('PLATFORM', 'BRAND', 'CLUB', 'BUSINESS');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_REVIEW', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "RoleScope" ADD VALUE IF NOT EXISTS 'ORGANIZATION';

-- CreateTable organizations
CREATE TABLE IF NOT EXISTS "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable organization_domains
CREATE TABLE IF NOT EXISTS "organization_domains" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable organization_memberships
CREATE TABLE IF NOT EXISTS "organization_memberships" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- AlterTable roles
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "organization_type" "OrganizationType";

-- AlterTable clubs
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;

-- AlterTable business_profiles
ALTER TABLE "business_profiles" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX IF NOT EXISTS "organizations_type_status_idx" ON "organizations"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "organization_domains_hostname_key" ON "organization_domains"("hostname");
CREATE INDEX IF NOT EXISTS "org_domains_org_idx" ON "organization_domains"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "org_memberships_org_user_unique" ON "organization_memberships"("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "org_memberships_org_status_idx" ON "organization_memberships"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "org_memberships_user_idx" ON "organization_memberships"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "roles_organization_idx" ON "roles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "clubs_slug_key" ON "clubs"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "clubs_organization_id_key" ON "clubs"("organization_id");
CREATE INDEX IF NOT EXISTS "clubs_organization_idx" ON "clubs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "business_profiles_organization_id_key" ON "business_profiles"("organization_id");
CREATE INDEX IF NOT EXISTS "business_organization_idx" ON "business_profiles"("organization_id");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_domains_organization_id_fkey') THEN
        ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_memberships_organization_id_fkey') THEN
        ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_memberships_user_id_fkey') THEN
        ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_memberships_role_id_fkey') THEN
        ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_organization_id_fkey') THEN
        ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clubs_organization_id_fkey') THEN
        ALTER TABLE "clubs" ADD CONSTRAINT "clubs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_profiles_organization_id_fkey') THEN
        ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
