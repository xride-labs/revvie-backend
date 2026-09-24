import fs from "fs";
import path from "path";
import type { Client } from "pg";

export interface SchemaParityResult {
  updated: boolean;
  appliedMigrations: string[];
  totalTargetMigrations: number;
}

/**
 * Ensures the target backup database has all schema migrations applied.
 * Checks _prisma_migrations on target and compares with migration directories
 * in prisma/migrations. Applies any missing migrations in order.
 */
export async function ensureTargetSchemaParity(
  targetClient: Client,
  projectRoot: string
): Promise<SchemaParityResult> {
  const migrationsDir = path.resolve(projectRoot, "prisma", "migrations");
  if (!fs.existsSync(migrationsDir)) {
    console.warn(`[Backup Schema] Migrations directory not found at: ${migrationsDir}`);
    return { updated: false, appliedMigrations: [], totalTargetMigrations: 0 };
  }

  // Ensure _prisma_migrations table exists
  await targetClient.query(`
    CREATE TABLE IF NOT EXISTS _prisma_migrations (
      id VARCHAR(36) PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL,
      logs TEXT,
      rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Ensure prerequisite enums and RBAC tables exist if not present
  try {
    await targetClient.query(`
      DO $$ BEGIN
        CREATE TYPE "RoleScope" AS ENUM ('GLOBAL', 'CLUB', 'BUSINESS');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      DO $$ BEGIN
        CREATE TYPE "PermissionScope" AS ENUM ('SYSTEM', 'CLUB', 'BUSINESS');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE IF NOT EXISTS "roles" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "description" TEXT,
        "scope" "RoleScope" NOT NULL DEFAULT 'GLOBAL',
        "scope_id" TEXT,
        "is_system" BOOLEAN NOT NULL DEFAULT false,
        "color" TEXT DEFAULT '#f97316',
        "icon" TEXT DEFAULT 'shield',
        "priority" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS "permissions" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "code" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "scope" "PermissionScope" NOT NULL DEFAULT 'SYSTEM',
        "description" TEXT,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "is_system" BOOLEAN NOT NULL DEFAULT true,
        "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS "role_permissions" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "permission_id" TEXT NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "assigned_at" TIMESTAMP NOT NULL DEFAULT now()
      );

      -- Collaborative lists tables
      CREATE TABLE IF NOT EXISTS "saved_place_lists" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "icon" TEXT DEFAULT 'map-pin',
        "color" TEXT DEFAULT '#8B5CF6',
        "is_public" BOOLEAN NOT NULL DEFAULT false,
        "is_default" BOOLEAN NOT NULL DEFAULT false,
        "is_collaborative" BOOLEAN NOT NULL DEFAULT false,
        "share_code" TEXT UNIQUE,
        "invite_token" TEXT UNIQUE,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS "saved_place_lists_user_idx" ON "saved_place_lists"("user_id");

      DO $$ BEGIN
        CREATE TYPE "SavedPlaceListRole" AS ENUM ('OWNER', 'CONTRIBUTOR', 'VIEWER');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE IF NOT EXISTS "saved_place_list_members" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "list_id" TEXT NOT NULL REFERENCES "saved_place_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "role" "SavedPlaceListRole" NOT NULL DEFAULT 'CONTRIBUTOR',
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "saved_place_list_members_unique" ON "saved_place_list_members"("list_id", "user_id");
      CREATE INDEX IF NOT EXISTS "saved_place_list_members_user_idx" ON "saved_place_list_members"("user_id");
      CREATE INDEX IF NOT EXISTS "saved_place_list_members_list_idx" ON "saved_place_list_members"("list_id");

      ALTER TABLE "saved_locations" ADD COLUMN IF NOT EXISTS "list_id" TEXT REFERENCES "saved_place_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      ALTER TABLE "saved_locations" ADD COLUMN IF NOT EXISTS "added_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    `);
  } catch (err) {
    console.warn(`[Backup Schema] Prerequisites notice:`, (err as Error).message);
  }

  // 1. Get applied migrations on target
  let appliedOnTarget: Set<string> = new Set();
  try {
    const res = await targetClient.query(
      `SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY started_at ASC`
    );
    appliedOnTarget = new Set(res.rows.map((r) => r.migration_name));
  } catch {
    // Empty set
  }

  // 2. Discover local migrations
  const migrationFolders = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const missingMigrations = migrationFolders.filter((m) => !appliedOnTarget.has(m));

  if (missingMigrations.length === 0) {
    console.log(`[Backup Schema] Backup DB schema is up to date (${appliedOnTarget.size} migrations applied).`);
    return {
      updated: false,
      appliedMigrations: [],
      totalTargetMigrations: appliedOnTarget.size,
    };
  }

  console.log(
    `[Backup Schema] Found ${missingMigrations.length} pending migrations to apply:`,
    missingMigrations
  );

  // 3. Apply missing migrations directly via SQL
  for (const migName of missingMigrations) {
    const sqlFile = path.join(migrationsDir, migName, "migration.sql");
    if (!fs.existsSync(sqlFile)) {
      continue;
    }
    const sql = fs.readFileSync(sqlFile, "utf-8");

    if (migName === "20260914100000_sync_rbac_collab_passkeys") {
      try {
        await targetClient.query(`
          ALTER TABLE "user_role_assignments" ADD COLUMN IF NOT EXISTS "role_id" TEXT REFERENCES "roles"("id") ON DELETE CASCADE;
          ALTER TABLE "club_members" ADD COLUMN IF NOT EXISTS "role_id" TEXT REFERENCES "roles"("id") ON DELETE CASCADE;
        `);
      } catch {
        // Table might not exist yet
      }
    }

    console.log(`[Backup Schema] Applying migration: ${migName}`);
    await targetClient.query(sql);
    await targetClient.query(
      `INSERT INTO _prisma_migrations (
        id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
      ) VALUES (
        gen_random_uuid()::text, '', NOW(), $1, '', NULL, NOW(), 1
      ) ON CONFLICT (id) DO NOTHING`,
      [migName]
    );
  }

  const verifyRes = await targetClient.query(
    `SELECT count(*)::int as count FROM _prisma_migrations WHERE rolled_back_at IS NULL`
  );
  const totalCount = verifyRes.rows[0]?.count || 0;

  return {
    updated: true,
    appliedMigrations: missingMigrations,
    totalTargetMigrations: totalCount,
  };
}
