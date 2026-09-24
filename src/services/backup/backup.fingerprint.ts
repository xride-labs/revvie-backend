import crypto from "crypto";
import type { Client } from "pg";
import type { BackupFingerprint } from "./backup.types.js";

/**
 * Calculates a deterministic fingerprint of the database mutation state.
 * Combines:
 *  - Applied migrations count & latest migration
 *  - User table write stats (inserts, updates, deletes from pg_stat_user_tables)
 *  - Max updated_at / created_at timestamp across active tables
 *  - Total row counts across user tables
 */
export async function computeSourceFingerprint(client: Client): Promise<BackupFingerprint> {
  // 1. Check migrations
  let migrationCount = 0;
  let latestMigration: string | null = null;
  try {
    const migRes = await client.query(
      `SELECT count(*)::int as count, max(migration_name) as latest FROM _prisma_migrations`
    );
    if (migRes.rows.length > 0) {
      migrationCount = migRes.rows[0].count || 0;
      latestMigration = migRes.rows[0].latest || null;
    }
  } catch {
    // Migration table might not exist in an uninitialized DB
  }

  // 2. Query table mutation statistics
  let tableStatsSummary = "";
  try {
    const statsRes = await client.query(
      `SELECT relname, n_tup_ins, n_tup_upd, n_tup_del
       FROM pg_stat_user_tables
       ORDER BY relname`
    );
    tableStatsSummary = statsRes.rows
      .map((r) => `${r.relname}:${r.n_tup_ins}:${r.n_tup_upd}:${r.n_tup_del}`)
      .join(";");
  } catch {
    // Fallback if user stats are not accessible
  }

  // 3. Query max timestamp across key application tables
  const candidateTables = [
    "users",
    "rides",
    "chat_messages",
    "posts",
    "marketplace_listings",
    "reviews",
    "events",
    "clubs",
    "comments",
    "notifications",
  ];

  let maxTimestamp: string | null = null;
  const timestamps: Date[] = [];

  for (const table of candidateTables) {
    try {
      const colsRes = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         AND column_name IN ('updated_at', 'created_at')`,
        [table]
      );
      const cols = colsRes.rows.map((r) => r.column_name);
      if (cols.length > 0) {
        const selectParts = cols.map((c) => `max("${c}") as "max_${c}"`).join(", ");
        const res = await client.query(`SELECT ${selectParts} FROM "${table}"`);
        for (const c of cols) {
          const val = res.rows[0]?.[`max_${c}`];
          if (val instanceof Date) {
            timestamps.push(val);
          } else if (val) {
            timestamps.push(new Date(val));
          }
        }
      }
    } catch {
      // Ignore candidate errors
    }
  }

  if (timestamps.length > 0) {
    const latest = new Date(Math.max(...timestamps.map((t) => t.getTime())));
    maxTimestamp = latest.toISOString();
  }

  // 4. Query total rows across all public tables using pg_stat_user_tables (instant single query)
  let totalRows = 0;
  try {
    const statsCountRes = await client.query(
      `SELECT COALESCE(SUM(n_live_tup), 0)::int as total FROM pg_stat_user_tables`
    );
    totalRows = statsCountRes.rows[0]?.total || 0;
  } catch {
    // Fallback if stat tables are unavailable
  }

  const hashContent = [
    `migrations:${migrationCount}:${latestMigration || "none"}`,
    `stats:${tableStatsSummary}`,
    `max_ts:${maxTimestamp || "none"}`,
    `rows:${totalRows}`,
  ].join("|");

  const fingerprint = crypto.createHash("sha256").update(hashContent).digest("hex");

  return {
    migrationCount,
    latestMigration,
    totalRows,
    maxTimestamp,
    tableStatsHash: crypto.createHash("sha256").update(tableStatsSummary).digest("hex"),
    fingerprint,
  };
}
