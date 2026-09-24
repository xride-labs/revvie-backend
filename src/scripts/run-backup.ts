import "dotenv/config";
import { runDatabaseBackup } from "../services/backup/backup.service.js";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force") || args.includes("-f");

  console.log("=========================================");
  console.log("  Revvie Database Automated Backup CLI   ");
  console.log("=========================================");
  if (force) {
    console.log("Mode: FORCED (bypassing change detection)");
  } else {
    console.log("Mode: SMART (skips if no new data detected)");
  }
  console.log("");

  const result = await runDatabaseBackup({ force });

  console.log("");
  console.log("=========================================");
  console.log(`Backup Result: ${result.status}`);
  console.log(`Duration:      ${result.durationMs}ms`);
  if (result.reason) {
    console.log(`Reason:        ${result.reason}`);
  }
  if (result.tablesSynced !== undefined) {
    console.log(`Tables Synced: ${result.tablesSynced}`);
    console.log(`Rows Synced:   ${result.rowsSynced}`);
  }
  if (result.schemaUpdated) {
    console.log(`Schema:        Updated (${result.migrationsApplied} migrations applied)`);
  }
  if (result.error) {
    console.error(`Error:         ${result.error}`);
    process.exit(1);
  }
  console.log("=========================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error during backup:", err);
  process.exit(1);
});
