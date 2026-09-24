import { describe, it, expect, vi } from "vitest";
import { computeSourceFingerprint } from "./backup.fingerprint.js";
import { runDatabaseBackup } from "./backup.service.js";

describe("Database Backup Service", () => {
  describe("computeSourceFingerprint", () => {
    it("computes a deterministic SHA-256 fingerprint from database state", async () => {
      const mockClient: any = {
        query: vi.fn().mockImplementation((queryText: string) => {
          if (queryText.includes("_prisma_migrations")) {
            return Promise.resolve({
              rows: [{ count: 48, latest: "20260918120000_add_performance_indexes" }],
            });
          }
          if (queryText.includes("pg_stat_user_tables")) {
            return Promise.resolve({
              rows: [
                { relname: "users", n_tup_ins: 100, n_tup_upd: 50, n_tup_del: 2 },
                { relname: "rides", n_tup_ins: 30, n_tup_upd: 10, n_tup_del: 0 },
              ],
            });
          }
          if (queryText.includes("information_schema.tables")) {
            return Promise.resolve({
              rows: [{ table_name: "users" }, { table_name: "rides" }],
            });
          }
          if (queryText.includes("count(*)::int")) {
            return Promise.resolve({
              rows: [{ cnt: 25 }],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      const result1 = await computeSourceFingerprint(mockClient);
      const result2 = await computeSourceFingerprint(mockClient);

      expect(result1.fingerprint).toBeDefined();
      expect(result1.fingerprint.length).toBe(64); // SHA-256 hex string length
      expect(result1.fingerprint).toEqual(result2.fingerprint);
      expect(result1.migrationCount).toBe(48);
    });

    it("detects changes when write counters change", async () => {
      let insCount = 100;
      const mockClient: any = {
        query: vi.fn().mockImplementation((queryText: string) => {
          if (queryText.includes("_prisma_migrations")) {
            return Promise.resolve({ rows: [{ count: 48, latest: "latest_mig" }] });
          }
          if (queryText.includes("pg_stat_user_tables")) {
            return Promise.resolve({
              rows: [{ relname: "users", n_tup_ins: insCount, n_tup_upd: 50, n_tup_del: 2 }],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      const before = await computeSourceFingerprint(mockClient);
      insCount = 105; // 5 new inserts
      const after = await computeSourceFingerprint(mockClient);

      expect(before.fingerprint).not.toEqual(after.fingerprint);
    });
  });

  describe("runDatabaseBackup configuration guards", () => {
    it("returns SKIPPED when targetUrl is missing", async () => {
      const prev = process.env.BACKUP_DATABASE_URL;
      delete process.env.BACKUP_DATABASE_URL;

      const result = await runDatabaseBackup({ targetUrl: "" });
      expect(result.status).toBe("SKIPPED");
      expect(result.reason).toContain("BACKUP_DATABASE_URL");

      if (prev) process.env.BACKUP_DATABASE_URL = prev;
    });

    it("returns FAILED when source database URL is missing", async () => {
      const result = await runDatabaseBackup({
        sourceUrl: "",
        targetUrl: "postgresql://user:pass@localhost:5432/backup",
      });
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("Source database URL missing");
    });
  });
});
