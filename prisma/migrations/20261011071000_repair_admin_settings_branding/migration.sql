-- Forward-only repair for branding columns that exist in Prisma's
-- AdminSettings model but were never added by an applied historical migration.
-- Every operation is additive and idempotent, so this is safe for both the
-- local database and already-running production environments.

ALTER TABLE "admin_settings"
  ADD COLUMN IF NOT EXISTS "tagline" TEXT NOT NULL DEFAULT 'RIDE • TRACK • CONNECT',
  ADD COLUMN IF NOT EXISTS "logo_url" TEXT NOT NULL DEFAULT 'https://res.cloudinary.com/xride-labs/image/upload/revvie/icon_f6occl.png',
  ADD COLUMN IF NOT EXISTS "icon_url" TEXT NOT NULL DEFAULT 'https://res.cloudinary.com/xride-labs/image/upload/revvie/icon_f6occl.png',
  ADD COLUMN IF NOT EXISTS "favicon_url" TEXT,
  ADD COLUMN IF NOT EXISTS "deep_color" TEXT NOT NULL DEFAULT '#b3151f',
  ADD COLUMN IF NOT EXISTS "canvas_color" TEXT NOT NULL DEFAULT '#0d0d0f',
  ADD COLUMN IF NOT EXISTS "surface_color" TEXT NOT NULL DEFAULT '#1c1c1e',
  ADD COLUMN IF NOT EXISTS "border_color" TEXT NOT NULL DEFAULT '#3a3a3c',
  ADD COLUMN IF NOT EXISTS "font_family" TEXT NOT NULL DEFAULT 'Josefin Sans',
  ADD COLUMN IF NOT EXISTS "email_header_badge" TEXT NOT NULL DEFAULT 'OFFICIAL DISPATCH';
