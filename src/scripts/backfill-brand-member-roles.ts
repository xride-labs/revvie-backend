/**
 * Backfill `brand_members.role` (BrandMemberRole enum) → `brand_members.role_id`
 * (FK to the BUSINESS system Role rows seeded in Task 1).
 *
 * - `mapEnumToSlug` maps each of the four known enum values to its BUSINESS
 *   role slug; anything else throws loudly (no silent skips).
 * - The main flow is idempotent: rows that already have a `role_id` are
 *   skipped, and it asserts `count(role_id IS NULL) === 0` at the end.
 * - Safe to run before or after the `brand_member_role_fk` migration: if the
 *   legacy `role` enum column is already gone, the enum-copy step is skipped
 *   and only the verification runs.
 *
 * Run: `bun src/scripts/backfill-brand-member-roles.ts` from `backend/`.
 */
import { prisma } from "../lib/prisma.js";

const ENUM_TO_SLUG: Record<string, string> = {
  OWNER: "owner",
  ADMIN: "admin",
  MODERATOR: "moderator",
  MEMBER: "member",
};

export function mapEnumToSlug(value: string): string {
  const slug = ENUM_TO_SLUG[value];
  if (!slug) {
    throw new Error(
      `Unknown BrandMemberRole enum value "${value}" — expected one of ${Object.keys(ENUM_TO_SLUG).join(", ")}`
    );
  }
  return slug;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2
     ) AS exists`,
    table,
    column
  );
  return rows[0]?.exists ?? false;
}

interface RoleRow {
  id: string;
  slug: string;
}

interface LegacyRow {
  id: string;
  role: string;
}

export async function backfillBrandMemberRoles() {
  const hasRoleIdCol = await columnExists("brand_members", "role_id");
  if (!hasRoleIdCol) {
    const legacy = await prisma.$queryRawUnsafe<Array<{ role: string; count: bigint }>>(
      `SELECT "role"::text AS "role", COUNT(*)::bigint AS "count" FROM "brand_members" GROUP BY "role" ORDER BY "role"`
    );
    console.log(
      "[backfill] role_id column not present yet — legacy enum distribution:",
      JSON.stringify(legacy, (_, v) => (typeof v === "bigint" ? String(v) : v))
    );
    // Validate every present value maps cleanly so the migration backfill cannot hit an unknown.
    for (const row of legacy) mapEnumToSlug(row.role);
    console.log("[backfill] OK: all legacy enum values are mappable");
    return { total: legacy.reduce((n, r) => n + Number(r.count), 0), updated: 0, nullAfter: 0n };
  }

  const beforeNull = (await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "brand_members" WHERE "role_id" IS NULL`
  ))[0]?.count ?? 0n;
  const total = await prisma.brandMember.count();
  console.log(`[backfill] brand_members total=${total} role_id_null_before=${beforeNull}`);

  const roles = await prisma.$queryRawUnsafe<RoleRow[]>(
    `SELECT "id", "slug" FROM "roles" WHERE "scope" = 'BUSINESS' AND "scope_id" IS NULL AND "is_system" = true`
  );
  const roleIdBySlug = new Map(roles.map((r) => [r.slug, r.id]));
  for (const slug of Object.values(ENUM_TO_SLUG)) {
    if (!roleIdBySlug.has(slug)) {
      throw new Error(`Missing system BUSINESS role "${slug}" — run the Task 1 seeds first`);
    }
  }

  const legacyCol = await columnExists("brand_members", "role");
  const hasLegacyColumn = legacyCol;

  let updated = 0;
  if (hasLegacyColumn) {
    const rows = await prisma.$queryRawUnsafe<LegacyRow[]>(
      `SELECT "id", "role"::text AS "role" FROM "brand_members" WHERE "role_id" IS NULL`
    );
    for (const row of rows) {
      const slug = mapEnumToSlug(row.role);
      const roleId = roleIdBySlug.get(slug)!;
      await prisma.$executeRawUnsafe(`UPDATE "brand_members" SET "role_id" = $1 WHERE "id" = $2`, roleId, row.id);
      updated++;
    }
    console.log(`[backfill] linked ${updated} row(s) from legacy enum values`);
  } else {
    console.log("[backfill] legacy enum column already dropped — skipping enum copy");
  }

  const perSlug = await prisma.$queryRawUnsafe<Array<{ slug: string | null; count: bigint }>>(
    `SELECT r."slug" AS "slug", COUNT(*)::bigint AS "count"
     FROM "brand_members" bm LEFT JOIN "roles" r ON r."id" = bm."role_id"
     GROUP BY r."slug" ORDER BY r."slug"`
  );
  console.log("[backfill] per-role counts:", JSON.stringify(perSlug, (_, v) => (typeof v === "bigint" ? String(v) : v)));

  const afterNull = (await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "brand_members" WHERE "role_id" IS NULL`
  ))[0]?.count ?? 0n;
  console.log(`[backfill] role_id_null_after=${afterNull}`);
  if (afterNull !== 0n) {
    throw new Error(`[backfill] FAILED: ${afterNull} brand_members row(s) still have NULL role_id`);
  }
  console.log("[backfill] OK: every brand_members row has a role_id");
  return { total, updated, nullAfter: afterNull };
}

// Run directly if executed as script
if (process.argv[1]?.endsWith("backfill-brand-member-roles.ts")) {
  backfillBrandMemberRoles()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Backfill failed:", err);
      process.exit(1);
    });
}
