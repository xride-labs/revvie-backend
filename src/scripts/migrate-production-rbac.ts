import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: "backend/.env.render" });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DIRECT_URL or DATABASE_URL not found in backend/.env.render");
  process.exit(1);
}

interface PermissionDef {
  code: string;
  name: string;
  category: string;
  scope: "SYSTEM" | "CLUB" | "BUSINESS";
  description: string;
}

const ALL_PERMISSIONS: PermissionDef[] = [
  // ── System Administration ──
  {
    code: "system:admin",
    name: "Super Admin Platform Access",
    category: "System Administration",
    scope: "SYSTEM",
    description: "Full platform administrative control across all features and modules",
  },
  {
    code: "system:co_admin",
    name: "Co-Admin Platform Access",
    category: "System Administration",
    scope: "SYSTEM",
    description: "Broad dashboard and operational access for delegated platform admins",
  },
  {
    code: "system:manage_users",
    name: "Manage Platform Users",
    category: "System Administration",
    scope: "SYSTEM",
    description: "View, ban, unban, suspend, and manage all platform accounts",
  },
  {
    code: "system:manage_roles",
    name: "Manage System Roles & Permissions",
    category: "System Administration",
    scope: "SYSTEM",
    description: "Create, edit, and assign global and business roles and permissions",
  },
  {
    code: "system:view_analytics",
    name: "Platform Telemetry & Analytics",
    category: "System Administration",
    scope: "SYSTEM",
    description: "Global business KPIs, server metrics, revenue, and riding analytics",
  },
  {
    code: "system:manage_settings",
    name: "Platform Configuration",
    category: "System Administration",
    scope: "SYSTEM",
    description: "Global maintenance mode, auth gateways, SMS and email providers",
  },
  {
    code: "system:moderate_content",
    name: "Moderate User Content",
    category: "Moderation",
    scope: "SYSTEM",
    description: "Review reported rides, clubs, marketplace listings, and chat logs",
  },
  {
    code: "system:manage_clubs",
    name: "Global Club Governance",
    category: "Clubs",
    scope: "SYSTEM",
    description: "Verify, transfer ownership, freeze, or archive motorcycle clubs",
  },
  {
    code: "system:manage_marketplace",
    name: "Marketplace Governance",
    category: "Marketplace",
    scope: "SYSTEM",
    description: "Approve sellers, resolve trade disputes, manage categories",
  },
  {
    code: "system:manage_brands",
    name: "Brand Partnerships",
    category: "Commerce",
    scope: "SYSTEM",
    description: "Manage official OEM motorcycle brands, verified dealers, and campaigns",
  },
  {
    code: "system:manage_billing",
    name: "Billing & Subscriptions",
    category: "Commerce",
    scope: "SYSTEM",
    description: "Manage Revvie Pro tiers, club subscriptions, and transaction refunds",
  },
  {
    code: "system:view_audit_logs",
    name: "Security Audit Logs",
    category: "Security",
    scope: "SYSTEM",
    description: "Inspect immutable tamper-evident platform action logs",
  },
  {
    code: "system:access_admin_portal",
    name: "Access Web Admin Portal",
    category: "System Administration",
    scope: "SYSTEM",
    description: "Permission to sign into the revvie web administrative console",
  },

  // ── Club Management ──
  {
    code: "club:view_analytics",
    name: "Club Telemetry & Analytics",
    category: "Club Telemetry",
    scope: "CLUB",
    description: "Deep analytics: aggregate odometer km, saddle hours, heatmaps, and rider leaderboard",
  },
  {
    code: "club:manage_settings",
    name: "Club Settings & Profile",
    category: "Club Management",
    scope: "CLUB",
    description: "Update club branding, description, privacy, and join policies",
  },
  {
    code: "club:manage_members",
    name: "Manage Members",
    category: "Club Management",
    scope: "CLUB",
    description: "Invite riders, accept/reject join applications, and remove members",
  },
  {
    code: "club:moderate_members",
    name: "Moderate Members",
    category: "Club Moderation",
    scope: "CLUB",
    description: "Mute, suspend, kick, and ban club members",
  },
  {
    code: "club:manage_roles",
    name: "Manage Custom Club Roles",
    category: "Club Management",
    scope: "CLUB",
    description: "Create and assign custom roles (Captain, Safety Officer) with custom permissions",
  },
  {
    code: "club:manage_join_requests",
    name: "Review Join Applications",
    category: "Club Management",
    scope: "CLUB",
    description: "Inspect applicant questionnaire answers and approve/deny membership",
  },
  {
    code: "club:manage_rides",
    name: "Organize Club Rides",
    category: "Club Activities",
    scope: "CLUB",
    description: "Create, schedule, broadcast, and lead official club rides",
  },
  {
    code: "club:manage_events",
    name: "Host Club Events & Rallies",
    category: "Club Activities",
    scope: "CLUB",
    description: "Publish club rallies, meetups, track days, and ticketing tiers",
  },
  {
    code: "club:manage_groups",
    name: "Manage Club Sub-Groups",
    category: "Club Communication",
    scope: "CLUB",
    description: "Create discussion channels and regional sub-groups",
  },
  {
    code: "club:moderate_chat",
    name: "Moderate Club Discussions",
    category: "Club Communication",
    scope: "CLUB",
    description: "Delete abusive messages and pin official club announcements",
  },
  {
    code: "club:broadcast_announcements",
    name: "Broadcast Club Announcements",
    category: "Club Communication",
    scope: "CLUB",
    description: "Send push notifications and broadcast alerts to all club members",
  },
  {
    code: "club:manage_listings",
    name: "Manage Club Classifieds",
    category: "Club Commerce",
    scope: "CLUB",
    description: "Pin and curate marketplace listings exclusive to the club",
  },
  {
    code: "club:export_data",
    name: "Export Club Data",
    category: "Club Management",
    scope: "CLUB",
    description: "Download CSV rosters, ride routes, and attendance records",
  },
  {
    code: "club:delete_club",
    name: "Delete Club",
    category: "Club Management",
    scope: "CLUB",
    description: "Permanently disband the club (Founder only)",
  },
  {
    code: "club:view_club",
    name: "View Club Content",
    category: "Club Membership",
    scope: "CLUB",
    description: "Participate in club discussions, view members, and join rides",
  },

  // ── Business & Brand ──
  {
    code: "business:manage",
    name: "Manage Business Profile",
    category: "Business Management",
    scope: "BUSINESS",
    description: "Manage brand profile, hours, contacts, and branch locations",
  },
  {
    code: "business:manage_listings",
    name: "Manage Inventory",
    category: "Business Management",
    scope: "BUSINESS",
    description: "Create, edit, and manage marketplace listings and inventory",
  },
  {
    code: "business:manage_deals",
    name: "Manage Deals & Campaigns",
    category: "Business Management",
    scope: "BUSINESS",
    description: "Create, schedule, and publish discount coupons and ad banners",
  },
  {
    code: "business:view_analytics",
    name: "View Business Analytics",
    category: "Business Management",
    scope: "BUSINESS",
    description: "View sales, inquiries, deal redemptions, and listing views",
  },
  {
    code: "business:manage_settings",
    name: "Manage Business Settings",
    category: "Business Management",
    scope: "BUSINESS",
    description: "Edit brand profile, verification, and business configuration",
  },
  {
    code: "business:manage_members",
    name: "Manage Business Members",
    category: "Business Management",
    scope: "BUSINESS",
    description: "Invite, remove, and manage brand team members",
  },
  {
    code: "business:manage_roles",
    name: "Manage Business Roles",
    category: "Business Management",
    scope: "BUSINESS",
    description: "Create custom brand roles and assign them to members",
  },
];

interface SystemRoleDef {
  slug: string;
  name: string;
  description: string;
  scope: "GLOBAL" | "CLUB" | "BUSINESS";
  color: string;
  icon: string;
  priority: number;
  permissions: string[];
}

const GLOBAL_SYSTEM_ROLES: SystemRoleDef[] = [
  {
    slug: "super_admin",
    name: "Super Administrator",
    description: "Unrestricted master access to entire platform infrastructure",
    scope: "GLOBAL",
    color: "#EF4444",
    icon: "shield-alert",
    priority: 100,
    permissions: ALL_PERMISSIONS.filter((p) => p.scope === "SYSTEM").map((p) => p.code),
  },
  {
    slug: "system_admin",
    name: "System Administrator",
    description: "Day-to-day platform ops, user management, and moderation",
    scope: "GLOBAL",
    color: "#F97316",
    icon: "shield-check",
    priority: 90,
    permissions: [
      "system:co_admin",
      "system:manage_users",
      "system:moderate_content",
      "system:manage_clubs",
      "system:manage_marketplace",
      "system:view_analytics",
      "system:access_admin_portal",
    ],
  },
  {
    slug: "admin",
    name: "Administrator",
    description: "Standard administrator with user support & content moderation capabilities",
    scope: "GLOBAL",
    color: "#EA580C",
    icon: "shield",
    priority: 85,
    permissions: [
      "system:manage_users",
      "system:moderate_content",
      "system:manage_clubs",
      "system:manage_marketplace",
      "system:view_analytics",
      "system:access_admin_portal",
    ],
  },
  {
    slug: "co_admin",
    name: "Co-Administrator",
    description: "Delegated administrator with broad dashboard and content review access",
    scope: "GLOBAL",
    color: "#D97706",
    icon: "shield",
    priority: 80,
    permissions: [
      "system:co_admin",
      "system:manage_users",
      "system:moderate_content",
      "system:access_admin_portal",
    ],
  },
  {
    slug: "moderator",
    name: "Platform Moderator",
    description: "Reviews reports, flags, and moderates user content",
    scope: "GLOBAL",
    color: "#8B5CF6",
    icon: "shield-half",
    priority: 50,
    permissions: ["system:moderate_content", "system:access_admin_portal"],
  },
  {
    slug: "support_agent",
    name: "Customer Support Agent",
    description: "Handles user tickets and account inquiries",
    scope: "GLOBAL",
    color: "#3B82F6",
    icon: "headphones",
    priority: 40,
    permissions: ["system:manage_users", "system:access_admin_portal"],
  },
  {
    slug: "analyst",
    name: "Data Analyst",
    description: "Read-only access to platform telemetry and business reports",
    scope: "GLOBAL",
    color: "#06B6D4",
    icon: "bar-chart",
    priority: 30,
    permissions: ["system:view_analytics", "system:access_admin_portal"],
  },
  {
    slug: "club_owner",
    name: "Club Owner",
    description: "Motorcycle club creator and manager",
    scope: "GLOBAL",
    color: "#F59E0B",
    icon: "crown",
    priority: 25,
    permissions: ["system:access_admin_portal"],
  },
  {
    slug: "brand_owner",
    name: "Brand Owner",
    description: "Owner of a motorcycle dealership, aftermarket brand, or gear store",
    scope: "GLOBAL",
    color: "#10B981",
    icon: "briefcase",
    priority: 20,
    permissions: ["system:access_admin_portal"],
  },
  {
    slug: "seller",
    name: "Marketplace Seller",
    description: "Active seller in the Revvie motorcycle classifieds marketplace",
    scope: "GLOBAL",
    color: "#14B8A6",
    icon: "shopping-bag",
    priority: 10,
    permissions: [],
  },
  {
    slug: "rider",
    name: "Active Rider",
    description: "Default rider account on the Revvie mobile network",
    scope: "GLOBAL",
    color: "#64748B",
    icon: "bike",
    priority: 0,
    permissions: [],
  },
];

const STANDARD_CLUB_ROLES: SystemRoleDef[] = [
  {
    slug: "owner",
    name: "Founder / Owner",
    description: "Creator and legal owner of the club with full governance",
    scope: "CLUB",
    color: "#F59E0B",
    icon: "crown",
    priority: 100,
    permissions: ALL_PERMISSIONS.filter((p) => p.scope === "CLUB").map((p) => p.code),
  },
  {
    slug: "admin",
    name: "Club Admin",
    description: "Executive club administrator managing members, rides, and settings",
    scope: "CLUB",
    color: "#3B82F6",
    icon: "shield-check",
    priority: 80,
    permissions: [
      "club:view_analytics",
      "club:manage_settings",
      "club:manage_members",
      "club:moderate_members",
      "club:manage_roles",
      "club:manage_join_requests",
      "club:manage_rides",
      "club:manage_events",
      "club:manage_groups",
      "club:moderate_chat",
      "club:broadcast_announcements",
      "club:manage_listings",
      "club:export_data",
      "club:view_club",
    ],
  },
  {
    slug: "moderator",
    name: "Moderator",
    description: "Maintains club decorum and moderates discussions",
    scope: "CLUB",
    color: "#8B5CF6",
    icon: "shield",
    priority: 60,
    permissions: [
      "club:moderate_members",
      "club:moderate_chat",
      "club:broadcast_announcements",
      "club:view_club",
    ],
  },
  {
    slug: "ride_captain",
    name: "Ride Captain",
    description: "Plans, leads, and coordinates official club rides",
    scope: "CLUB",
    color: "#10B981",
    icon: "compass",
    priority: 40,
    permissions: [
      "club:manage_rides",
      "club:broadcast_announcements",
      "club:view_club",
    ],
  },
  {
    slug: "member",
    name: "Club Member",
    description: "Standard active club member",
    scope: "CLUB",
    color: "#64748B",
    icon: "users",
    priority: 0,
    permissions: ["club:view_club"],
  },
];

const STANDARD_BUSINESS_ROLES: SystemRoleDef[] = [
  {
    slug: "owner",
    name: "Business Owner",
    description: "Full control of the business",
    scope: "BUSINESS",
    color: "#F59E0B",
    icon: "crown",
    priority: 100,
    permissions: [
      "business:manage",
      "business:manage_settings",
      "business:manage_members",
      "business:manage_roles",
      "business:manage_listings",
      "business:manage_deals",
      "business:view_analytics",
    ],
  },
  {
    slug: "admin",
    name: "Business Admin",
    description: "Manage team, inventory, and campaigns",
    scope: "BUSINESS",
    color: "#EF4444",
    icon: "shield",
    priority: 80,
    permissions: [
      "business:manage",
      "business:manage_settings",
      "business:manage_members",
      "business:manage_listings",
      "business:manage_deals",
      "business:view_analytics",
    ],
  },
  {
    slug: "moderator",
    name: "Business Moderator",
    description: "Inventory and campaign operations",
    scope: "BUSINESS",
    color: "#3B82F6",
    icon: "eye",
    priority: 60,
    permissions: [
      "business:manage_listings",
      "business:manage_deals",
      "business:view_analytics",
    ],
  },
  {
    slug: "member",
    name: "Business Member",
    description: "Read-only team member",
    scope: "BUSINESS",
    color: "#8E8E93",
    icon: "user",
    priority: 10,
    permissions: [],
  },
];

async function migrateProduction() {
  console.log("🚀 Starting Production Database Migration on Supabase...");
  const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query("BEGIN;");

    console.log("1️⃣ Creating Enums: PermissionScope, RoleScope...");
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "PermissionScope" AS ENUM ('SYSTEM', 'CLUB', 'BUSINESS');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;

      DO $$ BEGIN
        CREATE TYPE "RoleScope" AS ENUM ('GLOBAL', 'CLUB', 'BUSINESS');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    console.log("2️⃣ Creating Tables: permissions, roles, role_permissions...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id text PRIMARY KEY DEFAULT gen_random_uuid(),
        code text UNIQUE NOT NULL,
        name text NOT NULL,
        category text NOT NULL,
        scope "PermissionScope" NOT NULL DEFAULT 'SYSTEM',
        description text,
        created_at timestamp without time zone NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS roles (
        id text PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        slug text NOT NULL,
        description text,
        scope "RoleScope" NOT NULL DEFAULT 'GLOBAL',
        scope_id text,
        is_system boolean NOT NULL DEFAULT false,
        color text DEFAULT '#ff1d2d',
        icon text DEFAULT 'shield',
        priority integer NOT NULL DEFAULT 0,
        created_at timestamp without time zone NOT NULL DEFAULT now(),
        updated_at timestamp without time zone NOT NULL DEFAULT now(),
        CONSTRAINT roles_slug_scope_scope_id_unique UNIQUE NULLS NOT DISTINCT (slug, scope, scope_id)
      );

      CREATE INDEX IF NOT EXISTS roles_scope_scope_id_idx ON roles (scope, scope_id);
      CREATE INDEX IF NOT EXISTS roles_is_system_idx ON roles (is_system);

      CREATE TABLE IF NOT EXISTS role_permissions (
        id text PRIMARY KEY DEFAULT gen_random_uuid(),
        role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id text NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        assigned_at timestamp without time zone NOT NULL DEFAULT now(),
        CONSTRAINT role_permissions_role_permission_unique UNIQUE (role_id, permission_id)
      );

      CREATE INDEX IF NOT EXISTS role_permissions_role_idx ON role_permissions (role_id);
      CREATE INDEX IF NOT EXISTS role_permissions_permission_idx ON role_permissions (permission_id);
    `);

    console.log("3️⃣ Seeding All Permissions...");
    const permMap = new Map<string, string>(); // code -> id
    for (const p of ALL_PERMISSIONS) {
      const res = await client.query(
        `
        INSERT INTO permissions (id, code, name, category, scope, description, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4::"PermissionScope", $5, now())
        ON CONFLICT (code) DO UPDATE
        SET name = EXCLUDED.name, category = EXCLUDED.category, scope = EXCLUDED.scope, description = EXCLUDED.description, updated_at = now()
        RETURNING id, code;
        `,
        [p.code, p.name, p.category, p.scope, p.description]
      );
      permMap.set(res.rows[0].code, res.rows[0].id);
    }
    console.log(`✅ Seeded ${permMap.size} permissions`);

    console.log("4️⃣ Seeding Global System Roles & Standard Club Roles...");
    const roleMap = new Map<string, string>(); // slug:scope -> id
    const allRoles = [...GLOBAL_SYSTEM_ROLES, ...STANDARD_CLUB_ROLES, ...STANDARD_BUSINESS_ROLES];

    for (const r of allRoles) {
      const res = await client.query(
        `
        INSERT INTO roles (id, name, slug, description, scope, scope_id, is_system, color, icon, priority, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4::"RoleScope", NULL, true, $5, $6, $7, now())
        ON CONFLICT (slug, scope, scope_id) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true,
            color = EXCLUDED.color, icon = EXCLUDED.icon, priority = EXCLUDED.priority, updated_at = now()
        RETURNING id, slug, scope;
        `,
        [r.name, r.slug, r.description, r.scope, r.color, r.icon, r.priority]
      );
      const roleId = res.rows[0].id;
      roleMap.set(`${r.slug}:${r.scope}`, roleId);

      // Seed permissions for role
      for (const permCode of r.permissions) {
        const permId = permMap.get(permCode);
        if (permId) {
          await client.query(
            `
            INSERT INTO role_permissions (id, role_id, permission_id)
            VALUES (gen_random_uuid(), $1, $2)
            ON CONFLICT (role_id, permission_id) DO NOTHING;
            `,
            [roleId, permId]
          );
        }
      }
    }
    console.log(`✅ Seeded ${roleMap.size} roles and mapped permissions`);

    console.log("5️⃣ Migrating user_role_assignments: dropping legacy role, adding role_id NOT NULL...");
    // Add role_id column if not exists
    await client.query(`
      ALTER TABLE user_role_assignments 
      ADD COLUMN IF NOT EXISTS role_id text REFERENCES roles(id) ON DELETE CASCADE;
    `);

    // Backfill role_id from existing role string/enum
    const roleMapping: Record<string, string> = {
      ADMIN: roleMap.get("admin:GLOBAL")!,
      SUPER_ADMIN: roleMap.get("super_admin:GLOBAL")!,
      CO_ADMIN: roleMap.get("co_admin:GLOBAL")!,
      MODERATOR: roleMap.get("moderator:GLOBAL")!,
      CLUB_OWNER: roleMap.get("club_owner:GLOBAL")!,
      BRAND_OWNER: roleMap.get("brand_owner:GLOBAL")!,
      SELLER: roleMap.get("seller:GLOBAL")!,
      RIDER: roleMap.get("rider:GLOBAL")!,
    };

    for (const [legacyRole, targetRoleId] of Object.entries(roleMapping)) {
      if (targetRoleId) {
        await client.query(
          `
          UPDATE user_role_assignments 
          SET role_id = $1 
          WHERE role::text = $2 AND role_id IS NULL;
          `,
          [targetRoleId, legacyRole]
        );
      }
    }

    // Any remaining NULL role_id -> default to rider
    const riderRoleId = roleMap.get("rider:GLOBAL")!;
    await client.query(
      `UPDATE user_role_assignments SET role_id = $1 WHERE role_id IS NULL;`,
      [riderRoleId]
    );

    // Drop legacy column and constraints
    console.log("Dropping legacy role column from user_role_assignments...");
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignments_user_legacy_role_unique;
        ALTER TABLE user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignments_user_id_role_key;
      EXCEPTION WHEN OTHERS THEN null;
      END $$;

      ALTER TABLE user_role_assignments DROP COLUMN IF EXISTS role;
      ALTER TABLE user_role_assignments ALTER COLUMN role_id SET NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS user_role_assignments_user_role_unique 
      ON user_role_assignments (user_id, role_id);

      CREATE INDEX IF NOT EXISTS user_role_assignments_user_idx 
      ON user_role_assignments (user_id);

      CREATE INDEX IF NOT EXISTS user_role_assignments_role_idx 
      ON user_role_assignments (role_id);
    `);

    console.log("6️⃣ Migrating club_members: dropping legacy role, adding role_id NOT NULL...");
    await client.query(`
      ALTER TABLE club_members 
      ADD COLUMN IF NOT EXISTS role_id text REFERENCES roles(id) ON DELETE CASCADE;
    `);

    // Backfill role_id from existing club role
    const clubRoleMapping: Record<string, string> = {
      FOUNDER: roleMap.get("owner:CLUB")!,
      OWNER: roleMap.get("owner:CLUB")!,
      ADMIN: roleMap.get("admin:CLUB")!,
      OFFICER: roleMap.get("ride_captain:CLUB")!,
      MEMBER: roleMap.get("member:CLUB")!,
    };

    for (const [legacyRole, targetRoleId] of Object.entries(clubRoleMapping)) {
      if (targetRoleId) {
        await client.query(
          `
          UPDATE club_members 
          SET role_id = $1 
          WHERE role::text = $2 AND role_id IS NULL;
          `,
          [targetRoleId, legacyRole]
        );
      }
    }

    // Any remaining NULL role_id -> default to member:CLUB
    const memberRoleId = roleMap.get("member:CLUB")!;
    await client.query(
      `UPDATE club_members SET role_id = $1 WHERE role_id IS NULL;`,
      [memberRoleId]
    );

    // Drop legacy column
    console.log("Dropping legacy role column from club_members...");
    await client.query(`
      ALTER TABLE club_members DROP COLUMN IF EXISTS role;
      ALTER TABLE club_members ALTER COLUMN role_id SET NOT NULL;

      CREATE INDEX IF NOT EXISTS club_members_role_idx 
      ON club_members (role_id);
    `);

    console.log("7️⃣ Ensuring clubs, club_join_requests, user_preferences columns exist...");
    await client.query(`
      ALTER TABLE clubs 
      ADD COLUMN IF NOT EXISTS join_policy text NOT NULL DEFAULT 'OPEN',
      ADD COLUMN IF NOT EXISTS join_questions jsonb;

      ALTER TABLE club_join_requests 
      ADD COLUMN IF NOT EXISTS answers jsonb;

      ALTER TABLE user_preferences 
      ADD COLUMN IF NOT EXISTS home_widgets jsonb;
    `);

    console.log("8️⃣ Ensuring Super Admin roles assigned to primary admins...");
    const superAdminRoleId = roleMap.get("super_admin:GLOBAL")!;
    const adminEmails = ["admin@revvie.in", "krithikm923@gmail.com", "creativekrithik@gmail.com"];

    for (const email of adminEmails) {
      const u = await client.query(`SELECT id FROM users WHERE email = $1;`, [email]);
      if (u.rows.length > 0) {
        const userId = u.rows[0].id;
        await client.query(
          `
          INSERT INTO user_role_assignments (id, user_id, role_id)
          VALUES (gen_random_uuid(), $1, $2)
          ON CONFLICT (user_id, role_id) DO NOTHING;
          `,
          [userId, superAdminRoleId]
        );
        console.log(`✅ Granted SUPER_ADMIN to ${email} (${userId})`);
      }
    }

    console.log("9️⃣ Cleaning up orphaned enum types if safe...");
    await client.query(`
      DROP TYPE IF EXISTS "UserRole" CASCADE;
      DROP TYPE IF EXISTS "ClubMemberRole" CASCADE;
    `);

    await client.query("COMMIT;");
    console.log("🎉 PRODUCTION MIGRATION COMPLETED SUCCESSFULLY!");
  } catch (error) {
    await client.query("ROLLBACK;");
    console.error("❌ MIGRATION FAILED - ROLLED BACK:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateProduction().catch(console.error);
