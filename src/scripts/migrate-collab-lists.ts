import { Pool } from "pg";
import crypto from "crypto";

const PROD_DATABASE_URL =
  "postgresql://postgres.uvidmcblrxscmihsasgm:8xNBndAES%40revvie@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres";

const pool = new Pool({
  connectionString: PROD_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export const DEFAULT_LISTS = [
  { title: "Want to go", icon: "flag", color: "#F59E0B", description: "Places you want to visit and explore" },
  { title: "Travel plans", icon: "briefcase", color: "#3B82F6", description: "Itineraries, stops, and road trip milestones" },
  { title: "Favorites", icon: "heart", color: "#EF4444", description: "Your all-time favorite riding spots and stops" },
  { title: "Starred places", icon: "star", color: "#EAB308", description: "Special destinations and viewpoints" },
  { title: "Saved places", icon: "bookmark", color: "#10B981", description: "Quick saved locations and pit stops" },
];

export function generateShareCode(prefix = "RV"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${random.slice(0, 3)}-${random.slice(3)}`;
}

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("Beginning DDL migration for collaborative lists...");

    await client.query(`
      ALTER TABLE "saved_place_lists" ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE "saved_place_lists" ADD COLUMN IF NOT EXISTS "is_collaborative" BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE "saved_place_lists" ADD COLUMN IF NOT EXISTS "share_code" TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS "saved_place_lists_share_code_key" ON "saved_place_lists"("share_code");
      ALTER TABLE "saved_place_lists" ADD COLUMN IF NOT EXISTS "invite_token" TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS "saved_place_lists_invite_token_key" ON "saved_place_lists"("invite_token");

      ALTER TABLE "saved_locations" ADD COLUMN IF NOT EXISTS "added_by_id" TEXT;
      ALTER TABLE "saved_locations" DROP CONSTRAINT IF EXISTS "saved_locations_added_by_id_fkey";
      ALTER TABLE "saved_locations" ADD CONSTRAINT "saved_locations_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      CREATE INDEX IF NOT EXISTS "saved_locations_added_by_idx" ON "saved_locations"("added_by_id");

      DO $$ BEGIN
          CREATE TYPE "SavedPlaceListRole" AS ENUM ('OWNER', 'CONTRIBUTOR', 'VIEWER');
      EXCEPTION
          WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE IF NOT EXISTS "saved_place_list_members" (
          "id" TEXT NOT NULL,
          "list_id" TEXT NOT NULL,
          "user_id" TEXT NOT NULL,
          "role" "SavedPlaceListRole" NOT NULL DEFAULT 'CONTRIBUTOR',
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

          CONSTRAINT "saved_place_list_members_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "saved_place_list_members_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "saved_place_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "saved_place_list_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "saved_place_list_members_unique" ON "saved_place_list_members"("list_id", "user_id");
      CREATE INDEX IF NOT EXISTS "saved_place_list_members_user_idx" ON "saved_place_list_members"("user_id");
      CREATE INDEX IF NOT EXISTS "saved_place_list_members_list_idx" ON "saved_place_list_members"("list_id");
    `);

    console.log("DDL migration completed successfully.");

    // Backfill share_code and invite_token for existing lists
    const existingLists = await client.query(`SELECT id, title, share_code, invite_token, is_default FROM "saved_place_lists"`);
    console.log(`Checking ${existingLists.rows.length} existing lists for codes...`);

    for (const row of existingLists.rows) {
      let sc = row.share_code;
      let it = row.invite_token;
      let isDef = row.is_default;
      const titleLower = row.title.toLowerCase().trim();

      // Mark default lists
      if (["want to go", "travel plans", "favorites", "starred places", "saved places"].includes(titleLower)) {
        isDef = true;
      }

      if (!sc) sc = generateShareCode("RV");
      if (!it) it = crypto.randomBytes(16).toString("hex");

      await client.query(
        `UPDATE "saved_place_lists" SET share_code = $1, invite_token = $2, is_default = $3 WHERE id = $4`,
        [sc, it, isDef, row.id]
      );
    }
    console.log("Existing lists updated with codes and default flags.");

    // Ensure all default lists exist for user cmr0f6pax0001qkd2466anhot
    const targetUserId = "cmr0f6pax0001qkd2466anhot";
    const userLists = await client.query(`SELECT title FROM "saved_place_lists" WHERE user_id = $1`, [targetUserId]);
    const existingTitles = new Set(userLists.rows.map(r => r.title.toLowerCase().trim()));

    for (const def of DEFAULT_LISTS) {
      if (!existingTitles.has(def.title.toLowerCase().trim())) {
        const id = `cm${crypto.randomBytes(11).toString("hex")}`;
        const sc = generateShareCode("RV");
        const it = crypto.randomBytes(16).toString("hex");
        await client.query(
          `INSERT INTO "saved_place_lists" (id, user_id, title, description, icon, color, is_public, is_default, is_collaborative, share_code, invite_token, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, false, true, false, $7, $8, NOW(), NOW())`,
          [id, targetUserId, def.title, def.description, def.icon, def.color, sc, it]
        );
        console.log(`Created missing default list: "${def.title}" for user ${targetUserId}`);
      } else {
        console.log(`Default list already exists: "${def.title}"`);
      }
    }

    console.log("Migration and backfill completed successfully!");
  } catch (err) {
    console.error("Migration error:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
