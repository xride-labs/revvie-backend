import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // The Prisma CLI (migrate / db push / studio) needs a DIRECT database
    // connection. On Supabase the transaction pooler (port 6543) cannot run
    // DDL or acquire the advisory lock Prisma uses, so `prisma migrate` hangs
    // or errors against it. Point DIRECT_URL at the Supabase *direct* (or
    // *session pooler*) connection on port 5432. Falls back to DATABASE_URL
    // for local/Neon where the same URL works for both runtime and migrations.
    //
    // NOTE: the running app (src/lib/prisma.ts) still uses DATABASE_URL — keep
    // that as the pooled (6543) URL in production for healthy connection reuse.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
});
