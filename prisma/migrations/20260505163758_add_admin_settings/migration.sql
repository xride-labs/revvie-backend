-- CreateTable
CREATE TABLE "admin_settings" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "site_name" TEXT NOT NULL DEFAULT 'Zoomies',
    "site_url" TEXT NOT NULL DEFAULT 'https://zoomies.app',
    "support_email" TEXT NOT NULL DEFAULT 'support@zoomies.app',
    "timezone" TEXT NOT NULL DEFAULT 'America/Phoenix',
    "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
    "allow_registration" BOOLEAN NOT NULL DEFAULT true,
    "marketplace_enabled" BOOLEAN NOT NULL DEFAULT true,
    "club_creation_enabled" BOOLEAN NOT NULL DEFAULT true,
    "require_admin_2fa" BOOLEAN NOT NULL DEFAULT false,
    "session_timeout_minutes" INTEGER NOT NULL DEFAULT 30,
    "password_strength" TEXT NOT NULL DEFAULT 'strong',
    "login_attempts" INTEGER NOT NULL DEFAULT 5,
    "notify_new_user" BOOLEAN NOT NULL DEFAULT true,
    "notify_new_reports" BOOLEAN NOT NULL DEFAULT true,
    "notify_club_verification" BOOLEAN NOT NULL DEFAULT true,
    "notify_system_alerts" BOOLEAN NOT NULL DEFAULT true,
    "notify_daily_summary" BOOLEAN NOT NULL DEFAULT false,
    "smtp_host" TEXT NOT NULL DEFAULT 'smtp.sendgrid.net',
    "smtp_port" INTEGER NOT NULL DEFAULT 587,
    "smtp_user" TEXT NOT NULL DEFAULT 'apikey',
    "smtp_pass" TEXT NOT NULL DEFAULT '',
    "from_email" TEXT NOT NULL DEFAULT 'noreply@zoomies.app',
    "from_name" TEXT NOT NULL DEFAULT 'Zoomies',
    "welcome_email_subject" TEXT NOT NULL DEFAULT 'Welcome to Zoomies!',
    "welcome_email_body" TEXT NOT NULL DEFAULT 'Hi {{name}}, Welcome to Zoomies!',
    "primary_color" TEXT NOT NULL DEFAULT '#ff1d2d',
    "dark_mode_default" BOOLEAN NOT NULL DEFAULT false,
    "compact_mode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_settings_scope_key" ON "admin_settings"("scope");
