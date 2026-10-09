import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import type { BackupOptions, BackupResult } from "./backup.types.js";
import { computeSourceFingerprint } from "./backup.fingerprint.js";
import { ensureTargetSchemaParity } from "./backup.schema.js";

const { Client } = pg;

function resolveProjectRoot(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.resolve(__dirname, "../../../");
  } catch {
    return process.cwd();
  }
}

function createClient(connectionString: string): pg.Client {
  const isSsl =
    connectionString.includes("sslmode=require") ||
    connectionString.includes("neon.tech") ||
    connectionString.includes("supabase.com") ||
    connectionString.includes("pooler.supabase.com");

  return new Client({
    connectionString,
    ssl: isSsl ? { rejectUnauthorized: false } : false,
    statement_timeout: 120_000,
    query_timeout: 120_000,
  });
}

/**
 * The backup process truncates every application table on its target before
 * copying rows. A Supabase URL is the production database in this deployment,
 * so treating one as a routine backup target can erase production data when
 * source and target environment variables are accidentally reversed.
 *
 * A one-off recovery may intentionally target Supabase. That requires the
 * explicit, process-scoped BACKUP_ALLOW_PRODUCTION_TARGET=true override so it
 * cannot happen through a normal scheduled job.
 */
function getUnsafeBackupTargetReason(targetUrl: string): string | null {
  if (process.env.BACKUP_ALLOW_PRODUCTION_TARGET === "true") {
    return null;
  }

  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    const isSupabase =
      host === "supabase.com" ||
      host.endsWith(".supabase.com") ||
      host.endsWith(".supabase.co");

    if (isSupabase) {
      return "Refusing to use Supabase as a truncating backup target. Set BACKUP_ALLOW_PRODUCTION_TARGET=true only for an intentional, supervised restore.";
    }
  } catch {
    return "Backup target URL is invalid.";
  }

  return null;
}

/**
 * Computes topological sorting of tables based on foreign key relationships
 * so parent tables are inserted before dependent child tables.
 */
async function getTopologicallySortedTables(client: pg.Client): Promise<string[]> {
  const fkRes = await client.query(`
    SELECT DISTINCT
      tc.table_name,
      ccu.table_name AS foreign_table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name != ccu.table_name;
  `);

  const tablesRes = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('_backup_history', '_prisma_migrations')
    ORDER BY table_name;
  `);

  const allTables = tablesRes.rows.map((r) => r.table_name);
  const deps = new Map<string, Set<string>>();
  for (const t of allTables) {
    deps.set(t, new Set());
  }

  for (const row of fkRes.rows) {
    if (deps.has(row.table_name) && row.foreign_table_name !== row.table_name) {
      deps.get(row.table_name)!.add(row.foreign_table_name);
    }
  }

  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(t: string) {
    if (visited.has(t)) return;
    if (visiting.has(t)) return; // break cycles if any
    visiting.add(t);
    const parents = deps.get(t) || new Set();
    for (const p of parents) {
      if (allTables.includes(p)) {
        visit(p);
      }
    }
    visiting.delete(t);
    visited.add(t);
    sorted.push(t);
  }

  for (const t of allTables) {
    visit(t);
  }

  return sorted;
}

/**
 * Executes a full database backup from primary to target database.
 * Includes change-detection, schema migration updates, table-by-table replication
 * in topological dependency order, and sequence realignment.
 */
export async function runDatabaseBackup(options?: BackupOptions): Promise<BackupResult> {
  const startTime = Date.now();
  const sourceUrl =
    options?.sourceUrl !== undefined
      ? options.sourceUrl
      : process.env.DIRECT_URL || process.env.DATABASE_URL;

  const targetUrl =
    options?.targetUrl !== undefined
      ? options.targetUrl
      : process.env.BACKUP_DATABASE_URL;

  if (!targetUrl) {
    const msg = "[DB Backup] BACKUP_DATABASE_URL is not configured. Skipping backup.";
    console.warn(msg);
    return {
      status: "SKIPPED",
      reason: "BACKUP_DATABASE_URL not configured",
      durationMs: Date.now() - startTime,
    };
  }

  if (!sourceUrl) {
    const msg = "[DB Backup] Neither DIRECT_URL nor DATABASE_URL is configured. Cannot run backup.";
    console.error(msg);
    return {
      status: "FAILED",
      error: "Source database URL missing",
      durationMs: Date.now() - startTime,
    };
  }

  const unsafeTargetReason = getUnsafeBackupTargetReason(targetUrl);
  if (unsafeTargetReason) {
    console.error(`[DB Backup] ${unsafeTargetReason}`);
    return {
      status: "FAILED",
      error: unsafeTargetReason,
      durationMs: Date.now() - startTime,
    };
  }

  console.log(`[DB Backup] Initiating backup workflow...`);
  console.log(`[DB Backup] Force run: ${Boolean(options?.force)}`);

  const sourceClient = createClient(sourceUrl);
  const targetClient = createClient(targetUrl);
  let targetTransactionStarted = false;

  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    console.log(`[DB Backup] Connected to source and backup databases.`);

    // 1. Ensure _backup_history table exists on target
    await targetClient.query(`
      CREATE TABLE IF NOT EXISTS _backup_history (
        id TEXT PRIMARY KEY,
        source_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        tables_synced INT NOT NULL DEFAULT 0,
        rows_synced INT NOT NULL DEFAULT 0,
        duration_ms INT NOT NULL DEFAULT 0,
        schema_updated BOOLEAN NOT NULL DEFAULT false,
        started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        error_message TEXT
      );
    `);

    // 2. Compute source mutation fingerprint
    console.log(`[DB Backup] Computing source database fingerprint...`);
    const sourceFingerprint = await computeSourceFingerprint(sourceClient);
    console.log(`[DB Backup] Source fingerprint: ${sourceFingerprint.fingerprint.substring(0, 16)}...`);

    // 3. Check last successful backup from target
    const lastBackupRes = await targetClient.query(`
      SELECT source_fingerprint, completed_at
      FROM _backup_history
      WHERE status = 'SUCCESS'
      ORDER BY completed_at DESC
      LIMIT 1;
    `);

    const lastBackup = lastBackupRes.rows[0];
    const isUnchanged =
      lastBackup &&
      lastBackup.source_fingerprint === sourceFingerprint.fingerprint;

    if (isUnchanged && !options?.force) {
      const durationMs = Date.now() - startTime;
      console.log(
        `[DB Backup] No new data or schema changes detected since last backup at ${lastBackup.completed_at}. Skipping backup.`
      );
      return {
        status: "SKIPPED",
        reason: "No new data detected",
        sourceFingerprint: sourceFingerprint.fingerprint,
        previousFingerprint: lastBackup.source_fingerprint,
        durationMs,
      };
    }

    if (options?.force && isUnchanged) {
      console.log(`[DB Backup] Fingerprint matches previous backup, but --force was requested. Proceeding.`);
    }

    // 4. Ensure target schema parity with source
    const projectRoot = resolveProjectRoot();
    console.log(`[DB Backup] Checking schema parity...`);
    const schemaResult = await ensureTargetSchemaParity(targetClient, projectRoot);

    // 5. Query user tables from source and sort topologically
    console.log(`[DB Backup] Resolving table dependency order...`);
    const sortedTables = await getTopologicallySortedTables(sourceClient);
    console.log(`[DB Backup] Found ${sortedTables.length} tables to synchronize in dependency order.`);

    // 6. Keep the complete target mutation atomic. If a source row cannot be
    // copied, the target retains its last complete backup instead of being
    // left empty or partially restored after the truncate.
    await targetClient.query("BEGIN");
    targetTransactionStarted = true;

    // 7. Truncate all tables on target in a single multi-table CASCADE query
    if (sortedTables.length > 0) {
      console.log(`[DB Backup] Truncating target tables...`);
      const truncateList = sortedTables.map((t) => `"${t}"`).join(", ");
      await targetClient.query(`TRUNCATE TABLE ${truncateList} CASCADE;`);
    }

    let tablesSynced = 0;
    let rowsSynced = 0;

    // 8. Copy table data in topological order (parents first)
    for (const table of sortedTables) {
      // Query columns on source
      const srcColsRes = await sourceClient.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position;`,
        [table]
      );
      const srcCols = srcColsRes.rows.map((r) => r.column_name);

      // Query columns on target (intersection and types)
      const tgtColsRes = await targetClient.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position;`,
        [table]
      );
      const tgtColMap = new Map(tgtColsRes.rows.map((r) => [r.column_name, r.data_type]));
      const commonCols = srcCols.filter((c) => tgtColMap.has(c));

      if (commonCols.length === 0) {
        continue;
      }

      // Fetch rows from source
      const colList = commonCols.map((c) => `"${c}"`).join(", ");
      const rowsRes = await sourceClient.query(`SELECT ${colList} FROM "${table}";`);
      const rows = rowsRes.rows;

      if (rows.length > 0) {
        // Batch insert in chunks of 500 rows
        const BATCH_SIZE = 500;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const valueClauses: string[] = [];
          const params: any[] = [];
          let paramIndex = 1;

          for (const row of batch) {
            const rowParams: string[] = [];
            for (const col of commonCols) {
              rowParams.push(`$${paramIndex++}`);
              let val = row[col];
              const dType = tgtColMap.get(col);
              if ((dType === "json" || dType === "jsonb") && val !== null && val !== undefined) {
                if (typeof val === "object") {
                  val = JSON.stringify(val);
                }
              }
              params.push(val);
            }
            valueClauses.push(`(${rowParams.join(", ")})`);
          }

          const insertQuery = `
            INSERT INTO "${table}" (${colList})
            VALUES ${valueClauses.join(", ")};
          `;
          await targetClient.query(insertQuery, params);
        }
      }

      tablesSynced++;
      rowsSynced += rows.length;
    }

    // 9. Resynchronize serial sequences on target
    console.log(`[DB Backup] Resynchronizing sequences on target...`);
    const seqRes = await targetClient.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_default LIKE 'nextval%'
    `);

    for (const row of seqRes.rows) {
      try {
        await targetClient.query(`
          SELECT setval(
            pg_get_serial_sequence('"${row.table_name}"', '${row.column_name}'),
            COALESCE(MAX("${row.column_name}"), 1)
          ) FROM "${row.table_name}";
        `);
      } catch {
        // Ignore custom sequence errors
      }
    }

    const durationMs = Date.now() - startTime;
    const backupId = `bk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // 10. Record success in _backup_history
    await targetClient.query(
      `INSERT INTO _backup_history (
        id, source_fingerprint, status, tables_synced, rows_synced,
        duration_ms, schema_updated, started_at, completed_at, error_message
      ) VALUES ($1, $2, 'SUCCESS', $3, $4, $5, $6, $7, NOW(), NULL);`,
      [
        backupId,
        sourceFingerprint.fingerprint,
        tablesSynced,
        rowsSynced,
        durationMs,
        schemaResult.updated,
        new Date(startTime),
      ]
    );

    await targetClient.query("COMMIT");
    targetTransactionStarted = false;

    console.log(
      `[DB Backup] Backup completed successfully in ${durationMs}ms. Tables synced: ${tablesSynced}, Rows synced: ${rowsSynced}.`
    );

    return {
      status: "SUCCESS",
      sourceFingerprint: sourceFingerprint.fingerprint,
      previousFingerprint: lastBackup?.source_fingerprint || null,
      tablesSynced,
      rowsSynced,
      durationMs,
      schemaUpdated: schemaResult.updated,
      migrationsApplied: schemaResult.appliedMigrations.length,
    };
  } catch (error) {
    if (targetTransactionStarted) {
      try {
        await targetClient.query("ROLLBACK");
      } catch {
        // Preserve the original copy failure if the connection is unavailable.
      }
      targetTransactionStarted = false;
    }

    const durationMs = Date.now() - startTime;
    const errMsg = (error as Error).message;
    console.error(`[DB Backup] Backup failed after ${durationMs}ms:`, errMsg);

    try {
      const failId = `bk_fail_${Date.now()}`;
      await targetClient.query(
        `INSERT INTO _backup_history (
          id, source_fingerprint, status, tables_synced, rows_synced,
          duration_ms, schema_updated, started_at, completed_at, error_message
        ) VALUES ($1, '', 'FAILED', 0, 0, $2, false, $3, NOW(), $4);`,
        [failId, durationMs, new Date(startTime), errMsg]
      );
    } catch {
      // Target might be unreachable
    }

    return {
      status: "FAILED",
      error: errMsg,
      durationMs,
    };
  } finally {
    try {
      await Promise.all([sourceClient.end(), targetClient.end()]);
    } catch {
      // Ignore disconnect errors
    }
  }
}
