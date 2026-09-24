export interface BackupOptions {
  force?: boolean;
  sourceUrl?: string;
  targetUrl?: string;
}

export interface BackupFingerprint {
  migrationCount: number;
  latestMigration: string | null;
  totalRows: number;
  maxTimestamp: string | null;
  tableStatsHash: string;
  fingerprint: string;
}

export interface BackupResult {
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  reason?: string;
  sourceFingerprint?: string;
  previousFingerprint?: string | null;
  tablesSynced?: number;
  rowsSynced?: number;
  durationMs: number;
  schemaUpdated?: boolean;
  migrationsApplied?: number;
  error?: string;
}

export interface BackupHistoryRecord {
  id: string;
  source_fingerprint: string;
  status: string;
  tables_synced: number;
  rows_synced: number;
  duration_ms: number;
  schema_updated: boolean;
  started_at: Date;
  completed_at: Date;
  error_message?: string | null;
}
