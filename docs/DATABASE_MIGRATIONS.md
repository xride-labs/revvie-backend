# Database Migrations (Prisma + Supabase)

How to change the Postgres schema and ship it to production safely. Render does
**not** run migrations automatically in this project, so prod migrations are a
manual step — this doc is that step.

---

## TL;DR

```bash
cd backend

# 1. You (or Claude) edited prisma/schema.prisma. Create the migration locally:
bun run prisma:migrate            # = prisma migrate dev --name <name>

# 2. Apply it to PRODUCTION (Supabase) — needs the DIRECT connection:
#    set DIRECT_URL to the Supabase "Direct connection" string (port 5432), then:
bun run prisma:deploy             # = prisma migrate deploy

# 3. Regenerate the client wherever the app runs (Render rebuild does this):
bun run prisma:generate
```

If `prisma migrate` **hangs**, you're pointed at the pooler (port 6543). Use the
direct connection (5432). See [The Supabase gotcha](#the-supabase-gotcha).

---

## How this project is wired

- **Prisma 7** with the **`@prisma/adapter-pg` driver adapter**. The running app
  (`src/lib/prisma.ts`) connects with `DATABASE_URL`.
- The **Prisma CLI** (`migrate`, `db push`, `studio`) reads its connection from
  **`prisma.config.ts`**, which now resolves:

  ```ts
  url: process.env.DIRECT_URL || process.env.DATABASE_URL
  ```

  So set **`DIRECT_URL`** for migrations and **`DATABASE_URL`** for the app.
- Migrations live in `backend/prisma/migrations/<timestamp>_<name>/migration.sql`
  and are tracked in the DB's `_prisma_migrations` table.

### Two connection strings, two jobs

| Env var        | Used by            | Supabase connection                 | Port  |
| -------------- | ------------------ | ----------------------------------- | ----- |
| `DATABASE_URL` | the app at runtime | **Transaction pooler**              | 6543  |
| `DIRECT_URL`   | the Prisma CLI     | **Direct connection / Session pooler** | 5432 |

Find both in **Supabase → your project → Connect**.

---

## The Supabase gotcha

Supabase's **transaction pooler (port 6543)** is pgBouncer in transaction mode.
It's great for serverless app traffic but it **cannot**:

- run DDL reliably (`CREATE TABLE`, `ALTER TABLE`, …),
- hold the **advisory lock** Prisma takes during a migration,
- keep session state / prepared statements across statements.

So `prisma migrate dev` / `deploy` will **hang or error** on 6543. Migrations
must use a **direct connection on port 5432**:

- **Direct connection**: `postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres`
- or **Session pooler**: `postgresql://postgres.<ref>:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres`

(If your network has no IPv6, the **Session pooler** on 5432 is the IPv4-friendly
choice — the bare direct host is IPv6-only on newer Supabase projects.)

Append `?sslmode=require` if you hit TLS errors.

---

## The normal workflow (recommended)

### 1. Edit the schema

Change `prisma/schema.prisma` (add a model/column/index).

### 2. Create the migration **locally**

Run against your **local dev DB** (or any throwaway DB) so Prisma can diff the
schema and write the SQL:

```bash
cd backend
bun run prisma:migrate            # prisma migrate dev --name describe_change
```

This creates `prisma/migrations/<timestamp>_describe_change/migration.sql`,
applies it to your local DB, and regenerates the client. **Commit that folder.**

> If Claude already hand-wrote the migration folder for you (as with
> `20260629120000_add_club_marketplace`), skip the generate step — go straight to
> deploy. You can sanity-check it locally first with `bun run prisma:deploy`
> against your local DB.

### 3. Deploy to production (Supabase)

Point the CLI at the **direct** connection and apply pending migrations:

```bash
# backend/.env  (or export inline for a one-off)
DIRECT_URL="postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres"

bun run prisma:deploy             # prisma migrate deploy
```

`migrate deploy` only applies migrations that aren't recorded yet — it never
resets data and never prompts. Safe to re-run.

### 4. Make sure prod runs the new client

The app process needs the regenerated Prisma client. On Render this happens on
the next build (`build:render` → `prisma generate` via `postinstall`/`build`).
If you only ran the SQL without redeploying, trigger a redeploy.

---

## Doing it fully manually (Supabase SQL Editor)

If you can't (or don't want to) run the CLI against prod, paste the SQL by hand —
**but you must then tell Prisma it's applied**, or the next `migrate deploy` will
try to run it again.

1. Open the migration SQL, e.g.
   `prisma/migrations/20260629120000_add_club_marketplace/migration.sql`.
2. **Supabase → SQL Editor → New query** → paste the SQL → **Run**.
3. Record it in Prisma's history so the migration is considered applied:

   ```bash
   DIRECT_URL="<supabase direct 5432 url>" \
   bunx prisma migrate resolve --applied 20260629120000_add_club_marketplace
   ```

   (`migrate resolve --applied` writes the row into `_prisma_migrations` without
   re-running the SQL.)
4. Verify: `bun run prisma:status` should show **"Database schema is up to date"**.

Use this path only when needed — the CLI workflow above keeps history in sync
automatically.

---

## Applying THIS change: `add_club_marketplace`

Adds `club_id` + `visibility` to `marketplace_listings` (club-scoped listings,
PUBLIC vs CLUB_ONLY).

```bash
cd backend
# .env has DIRECT_URL set to the Supabase direct (5432) connection
bun run prisma:generate           # update the client for the new fields
bun run prisma:deploy             # apply the migration to Supabase
bun run prisma:status             # confirm: up to date
```

It's additive and non-destructive (new nullable column + a column with a default
+ an index + a nullable FK), so there's no data backfill and no downtime.

---

## Make Render migrate on deploy (optional, recommended)

Right now migrations are manual because Render's start command doesn't run them.
To automate, set Render's **Pre-Deploy Command** (Settings → Build & Deploy) to:

```bash
bun run prisma:deploy
```

and make sure the Render service has **`DIRECT_URL`** set to the Supabase direct
(5432) connection (in addition to `DATABASE_URL` on 6543 for the app).

A Pre-Deploy Command runs after build, before the new version goes live — the
right place for `migrate deploy`. (There's already a `deploy:render` script that
bundles `prisma migrate deploy` + prod seed if you'd rather use that.)

---

## Verifying & troubleshooting

```bash
bun run prisma:status             # which migrations are applied / pending
bun run prisma:validate           # schema is valid
bunx prisma migrate diff \
  --from-url "$DIRECT_URL" \
  --to-schema-datamodel prisma/schema.prisma   # exact drift between DB and schema
```

| Symptom | Cause | Fix |
| --- | --- | --- |
| `migrate` hangs forever | Pointed at the pooler (6543) | Use the direct/session connection (5432) via `DIRECT_URL` |
| `advisory lock` / `prepared statement` errors | Same — pooler in transaction mode | Same — use 5432 |
| `P3009` failed migration recorded | A prior migrate crashed mid-way | Inspect, fix the SQL, then `prisma migrate resolve --rolled-back <name>` (or `--applied` if it actually did apply) |
| `migrate deploy` says "No pending" but schema looks off | Migration history out of sync | `prisma migrate status`; if you ran SQL by hand, `migrate resolve --applied <name>` |
| Drift detected on `migrate dev` | DB changed outside Prisma | `prisma migrate diff …` to see it; reconcile by writing a migration that matches |

> **Never** run `prisma migrate reset` or `prisma db push` against production —
> `reset` drops all data; `db push` skips migration history and causes drift.
> Production = `migrate deploy` only.
