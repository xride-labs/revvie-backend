import "dotenv/config";
import pg from "pg";

const { Client } = pg;

async function syncFromNeon() {
  const neonUrl = process.env.BACKUP_DATABASE_URL;
  const localUrl = process.env.DATABASE_URL || "postgresql://admin:admin123@localhost:5432/revvie";

  if (!neonUrl) {
    console.error("❌ No BACKUP_DATABASE_URL found in .env");
    process.exit(1);
  }

  console.log("=========================================");
  console.log("  Syncing Reference Data from Neon Prod  ");
  console.log("=========================================");
  console.log(`Source (Neon):  ${new URL(neonUrl).host}`);
  console.log(`Target (Local): ${new URL(localUrl).host}`);

  const neonClient = new Client({
    connectionString: neonUrl,
    ssl: { rejectUnauthorized: false },
  });
  const localClient = new Client({
    connectionString: localUrl,
    ssl: false,
  });

  await neonClient.connect();
  await localClient.connect();

  console.log("Connected to both databases.\n");

  // Tables to pull from Neon that hold production reference data
  const tablesToSync = [
    "manufacturers",
    "bike_models",
    "places",
    "saved_place_lists",
    "saved_locations",
    "permissions",
    "roles",
    "role_permissions",
  ];

  for (const tableName of tablesToSync) {
    try {
      console.log(`📦 Checking table: ${tableName}...`);
      const { rows: sourceRows } = await neonClient.query(`SELECT * FROM "${tableName}"`);
      if (sourceRows.length === 0) {
        console.log(`   (0 rows in Neon, skipping)`);
        continue;
      }

      console.log(`   Found ${sourceRows.length} rows in Neon. Syncing to local...`);

      // Get columns present in local table to avoid schema mismatch
      const { rows: targetCols } = await localClient.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, [tableName]);
      const validColNames = new Set(targetCols.map((c) => c.column_name));

      // Batch insert / upsert into local
      let inserted = 0;
      for (const row of sourceRows) {
        const filteredKeys = Object.keys(row).filter((k) => validColNames.has(k));
        const filteredValues = filteredKeys.map((k) => row[k]);

        if (filteredKeys.length === 0) continue;

        const colNamesStr = filteredKeys.map((k) => `"${k}"`).join(", ");
        const placeholders = filteredKeys.map((_, i) => `$${i + 1}`).join(", ");
        
        // Use primary key conflict resolution
        const query = `
          INSERT INTO "${tableName}" (${colNamesStr})
          VALUES (${placeholders})
          ON CONFLICT DO NOTHING
        `;

        await localClient.query(query, filteredValues);
        inserted++;
      }
      console.log(`   ✅ Synced ${inserted} rows into local "${tableName}".`);
    } catch (err: any) {
      console.error(`   ⚠️ Error syncing "${tableName}":`, err.message);
    }
  }

  await neonClient.end();
  await localClient.end();
  console.log("\n🎉 Sync from Neon complete!\n");
}

syncFromNeon().catch((err) => {
  console.error("Fatal sync error:", err);
  process.exit(1);
});
