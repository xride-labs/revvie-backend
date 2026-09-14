import prisma from "../lib/prisma.js";

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
    code: "system:manage_clubs",
    name: "Verify & Manage Clubs",
    category: "System Administration",
    scope: "SYSTEM",
    description: "Verify clubs, feature clubs, or override any club administration",
  },
  {
    code: "system:moderate_content",
    name: "Moderate Platform Content",
    category: "System Administration",
    scope: "SYSTEM",
    description: "Moderate posts, comments, reviews, and resolve user reports",
  },
  {
    code: "system:view_metrics",
    name: "View Platform Metrics",
    category: "System Administration",
    scope: "SYSTEM",
    description: "Financial, telemetry, and operational platform-level metrics",
  },
  {
    code: "system:manage_marketplace",
    name: "Manage Marketplace",
    category: "System Administration",
    scope: "SYSTEM",
    description: "Moderate marketplace listings, categories, and disputes",
  },

  // ── Club Administration & Operations ──
  {
    code: "club:view_analytics",
    name: "View Club Analytics",
    category: "Club Analytics",
    scope: "CLUB",
    description: "Access club telemetry, distance metrics, saddle hours, growth timelines, and top riders leaderboard",
  },
  {
    code: "club:manage_settings",
    name: "Manage Club Settings & Join Flow",
    category: "Club Administration",
    scope: "CLUB",
    description: "Edit club profile, cover banner, join policy, and custom screening questions",
  },
  {
    code: "club:manage_members",
    name: "Manage Club Members",
    category: "Club Administration",
    scope: "CLUB",
    description: "Invite riders, accept members, promote, demote, and remove members",
  },
  {
    code: "club:moderate_members",
    name: "Moderate Club Members",
    category: "Club Moderation",
    scope: "CLUB",
    description: "Mute, suspend, or ban club members from chat and events",
  },
  {
    code: "club:manage_roles",
    name: "Manage Club Roles & Permissions",
    category: "Club Administration",
    scope: "CLUB",
    description: "Create, edit, and delete custom club roles, and assign roles to members",
  },
  {
    code: "club:manage_join_requests",
    name: "Manage Join Applications",
    category: "Club Administration",
    scope: "CLUB",
    description: "Review and approve/reject applicant submissions and screening questionnaire answers",
  },
  {
    code: "club:manage_rides",
    name: "Organize & Manage Club Rides",
    category: "Club Rides",
    scope: "CLUB",
    description: "Create official club rides, schedule routes, assign ride leads, and export itineraries",
  },
  {
    code: "club:manage_events",
    name: "Manage Club Events",
    category: "Club Events",
    scope: "CLUB",
    description: "Host ticketed events, check-in attendees, and track ticket orders",
  },
  {
    code: "club:manage_groups",
    name: "Manage Club Squads & Channels",
    category: "Club Community",
    scope: "CLUB",
    description: "Create and manage sub-channels, announcement groups, and squads",
  },
  {
    code: "club:moderate_chat",
    name: "Moderate Club Chat",
    category: "Club Moderation",
    scope: "CLUB",
    description: "Lock chat channels, delete messages, and post official broadcast announcements",
  },
  {
    code: "club:manage_listings",
    name: "Manage Club Marketplace",
    category: "Club Marketplace",
    scope: "CLUB",
    description: "Post, edit, and moderate merchandise and member listings in club market",
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

  // ── Rider / General User ──
  {
    code: "rider:join_rides",
    name: "Join Rides",
    category: "Rider Privileges",
    scope: "SYSTEM",
    description: "Join public group rides and club rides",
  },
  {
    code: "rider:create_rides",
    name: "Create Rides",
    category: "Rider Privileges",
    scope: "SYSTEM",
    description: "Create personal routes and public group rides",
  },
  {
    code: "rider:join_clubs",
    name: "Join Clubs",
    category: "Rider Privileges",
    scope: "SYSTEM",
    description: "Discover, join open clubs, or submit join applications",
  },
  {
    code: "rider:create_clubs",
    name: "Create Clubs",
    category: "Rider Privileges",
    scope: "SYSTEM",
    description: "Create and found new motorcycle clubs",
  },
  {
    code: "rider:create_listings",
    name: "Marketplace Selling",
    category: "Rider Privileges",
    scope: "SYSTEM",
    description: "List motorcycles and gear for sale in the marketplace",
  },
];

interface SystemRoleDef {
  name: string;
  slug: string;
  scope: "GLOBAL" | "CLUB" | "BUSINESS";
  color: string;
  icon: string;
  priority: number;
  description: string;
  permissionCodes: string[];
}

const SYSTEM_GLOBAL_ROLES: SystemRoleDef[] = [
  {
    name: "Super Admin",
    slug: "admin",
    scope: "GLOBAL",
    color: "#EF4444",
    icon: "shield-alert",
    priority: 100,
    description: "Full platform super administrator with unrestricted access",
    permissionCodes: ALL_PERMISSIONS.map((p) => p.code),
  },
  {
    name: "Co-Admin",
    slug: "co_admin",
    scope: "GLOBAL",
    color: "#F97316",
    icon: "shield",
    priority: 90,
    description: "Delegated platform administrator with broad dashboard and moderation powers",
    permissionCodes: [
      "system:co_admin",
      "system:manage_users",
      "system:manage_clubs",
      "system:moderate_content",
      "system:view_metrics",
      "system:manage_marketplace",
      "club:view_analytics",
      "club:manage_settings",
      "club:manage_members",
      "club:manage_rides",
      "club:manage_events",
      "rider:join_rides",
      "rider:create_rides",
      "rider:join_clubs",
      "rider:create_clubs",
      "rider:create_listings",
    ],
  },
  {
    name: "Platform Moderator",
    slug: "moderator",
    scope: "GLOBAL",
    color: "#EAB308",
    icon: "shield-check",
    priority: 80,
    description: "Content and community moderator",
    permissionCodes: [
      "system:moderate_content",
      "system:manage_marketplace",
      "rider:join_rides",
      "rider:create_rides",
      "rider:join_clubs",
      "rider:create_clubs",
    ],
  },
  {
    name: "Club Owner",
    slug: "club_owner",
    scope: "GLOBAL",
    color: "#8B5CF6",
    icon: "crown",
    priority: 70,
    description: "Club founder and primary owner with full club control and analytics",
    permissionCodes: [
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
      "club:manage_listings",
      "rider:join_rides",
      "rider:create_rides",
      "rider:join_clubs",
      "rider:create_clubs",
      "rider:create_listings",
    ],
  },
  {
    name: "Club Admin",
    slug: "club_admin",
    scope: "GLOBAL",
    color: "#3B82F6",
    icon: "award",
    priority: 60,
    description: "Club administrator managing club operations, rides, and members",
    permissionCodes: [
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
      "club:manage_listings",
      "rider:join_rides",
      "rider:create_rides",
      "rider:join_clubs",
    ],
  },
  {
    name: "Club Moderator",
    slug: "club_moderator",
    scope: "GLOBAL",
    color: "#06B6D4",
    icon: "shield-alert",
    priority: 50,
    description: "Club moderator overseeing member behavior and group discussions",
    permissionCodes: [
      "club:view_analytics",
      "club:moderate_members",
      "club:manage_join_requests",
      "club:manage_rides",
      "club:moderate_chat",
      "rider:join_rides",
      "rider:create_rides",
      "rider:join_clubs",
    ],
  },
  {
    name: "Brand Owner",
    slug: "brand_owner",
    scope: "GLOBAL",
    color: "#10B981",
    icon: "store",
    priority: 70,
    description: "Business and brand owner with full catalog, advertising, and analytics access",
    permissionCodes: [
      "business:manage",
      "business:manage_listings",
      "business:manage_deals",
      "business:view_analytics",
      "rider:join_rides",
      "rider:create_rides",
      "rider:join_clubs",
      "rider:create_listings",
    ],
  },
  {
    name: "Brand Admin",
    slug: "brand_admin",
    scope: "GLOBAL",
    color: "#14B8A6",
    icon: "briefcase",
    priority: 60,
    description: "Brand administrator managing inventory and customer deals",
    permissionCodes: [
      "business:manage_listings",
      "business:manage_deals",
      "rider:join_rides",
      "rider:create_rides",
      "rider:join_clubs",
      "rider:create_listings",
    ],
  },
  {
    name: "Brand Moderator",
    slug: "brand_moderator",
    scope: "GLOBAL",
    color: "#2DD4BF",
    icon: "tag",
    priority: 50,
    description: "Brand moderator managing listings",
    permissionCodes: [
      "business:manage_listings",
      "rider:join_rides",
      "rider:create_rides",
      "rider:join_clubs",
    ],
  },
  {
    name: "Rider",
    slug: "rider",
    scope: "GLOBAL",
    color: "#64748B",
    icon: "bike",
    priority: 10,
    description: "Standard active motorcycle rider",
    permissionCodes: [
      "rider:join_rides",
      "rider:create_rides",
      "rider:join_clubs",
      "rider:create_clubs",
      "rider:create_listings",
    ],
  },
  {
    name: "Seller",
    slug: "seller",
    scope: "GLOBAL",
    color: "#F59E0B",
    icon: "shopping-bag",
    priority: 20,
    description: "Marketplace seller with listing privileges",
    permissionCodes: [
      "rider:create_listings",
      "rider:join_rides",
      "rider:create_rides",
      "rider:join_clubs",
    ],
  },
];

const STANDARD_CLUB_ROLES: SystemRoleDef[] = [
  {
    name: "Club Founder",
    slug: "founder",
    scope: "CLUB",
    color: "#F59E0B",
    icon: "crown",
    priority: 100,
    description: "Founder and ultimate owner of the club",
    permissionCodes: [
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
      "club:manage_listings",
    ],
  },
  {
    name: "Club Admin",
    slug: "club_admin",
    scope: "CLUB",
    color: "#3B82F6",
    icon: "award",
    priority: 80,
    description: "Club administrator managing club operations, rides, and members",
    permissionCodes: [
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
      "club:manage_listings",
    ],
  },
  {
    name: "Club Officer / Moderator",
    slug: "officer",
    scope: "CLUB",
    color: "#06B6D4",
    icon: "shield",
    priority: 60,
    description: "Club officer assisting with rides, join requests, and chat moderation",
    permissionCodes: [
      "club:view_analytics",
      "club:moderate_members",
      "club:manage_join_requests",
      "club:manage_rides",
      "club:moderate_chat",
    ],
  },
  {
    name: "Ride Captain",
    slug: "ride_captain",
    scope: "CLUB",
    color: "#10B981",
    icon: "navigation",
    priority: 40,
    description: "Leads club rides and plans official route itineraries",
    permissionCodes: [
      "club:view_analytics",
      "club:manage_rides",
    ],
  },
  {
    name: "Club Member",
    slug: "member",
    scope: "CLUB",
    color: "#64748B",
    icon: "user",
    priority: 10,
    description: "Full active club member with participation privileges",
    permissionCodes: [],
  },
];

export async function runRbacMigration() {
  console.log("🚀 [RBAC Migration] Starting dynamic roles & permissions migration...");

  // 1. Create Enums and Tables if not exist
  console.log("📦 1. Ensuring DB tables and columns exist...");
  await prisma.$executeRawUnsafe(`
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

    CREATE TABLE IF NOT EXISTS "permissions" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "code" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "category" TEXT NOT NULL,
      "scope" "PermissionScope" NOT NULL DEFAULT 'SYSTEM',
      "is_system" BOOLEAN NOT NULL DEFAULT true,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "roles" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "description" TEXT,
      "scope" "RoleScope" NOT NULL DEFAULT 'GLOBAL',
      "scope_id" TEXT,
      "is_system" BOOLEAN NOT NULL DEFAULT false,
      "color" TEXT DEFAULT '#f97316',
      "icon" TEXT DEFAULT 'shield',
      "priority" INTEGER NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "role_permissions" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "permission_id" TEXT NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
      "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "role_permissions_role_permission_unique" UNIQUE ("role_id", "permission_id")
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS "permissions_scope_idx" ON "permissions"("scope");
    CREATE INDEX IF NOT EXISTS "permissions_category_idx" ON "permissions"("category");
    CREATE INDEX IF NOT EXISTS "roles_scope_scope_id_idx" ON "roles"("scope", "scope_id");
    CREATE INDEX IF NOT EXISTS "roles_is_system_idx" ON "roles"("is_system");
    CREATE UNIQUE INDEX IF NOT EXISTS "roles_slug_scope_scope_id_unique" ON "roles"("slug", "scope", COALESCE("scope_id", ''));
    CREATE INDEX IF NOT EXISTS "role_permissions_role_idx" ON "role_permissions"("role_id");
    CREATE INDEX IF NOT EXISTS "role_permissions_permission_idx" ON "role_permissions"("permission_id");

    -- Alter existing tables
    ALTER TABLE "user_role_assignments" ADD COLUMN IF NOT EXISTS "role_id" TEXT REFERENCES "roles"("id") ON DELETE CASCADE;
    ALTER TABLE "user_role_assignments" ADD COLUMN IF NOT EXISTS "assigned_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL;
    ALTER TABLE "user_role_assignments" ALTER COLUMN "role" DROP NOT NULL;
    CREATE INDEX IF NOT EXISTS "user_role_assignments_role_idx" ON "user_role_assignments"("role_id");

    ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "join_policy" TEXT NOT NULL DEFAULT 'OPEN';
    ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "join_questions" JSONB;

    ALTER TABLE "club_members" ADD COLUMN IF NOT EXISTS "role_id" TEXT REFERENCES "roles"("id") ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS "club_members_role_idx" ON "club_members"("role_id");

    ALTER TABLE "club_join_requests" ADD COLUMN IF NOT EXISTS "answers" JSONB;
    ALTER TABLE "club_join_requests" ADD COLUMN IF NOT EXISTS "reviewed_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL;
    ALTER TABLE "club_join_requests" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);
    ALTER TABLE "club_join_requests" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;
    CREATE INDEX IF NOT EXISTS "club_join_requests_club_status_idx" ON "club_join_requests"("club_id", "status");

    ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "home_widgets" JSONB;
  `);

  console.log("✅ Tables and columns created / verified.");

  // 2. Seed Permissions
  console.log("🔑 2. Upserting system permissions...");
  const permissionIdMap = new Map<string, string>();

  for (const perm of ALL_PERMISSIONS) {
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "permissions" WHERE "code" = $1 LIMIT 1`,
      perm.code
    );

    let id: string;
    if (existing && existing.length > 0) {
      id = existing[0].id;
      await prisma.$executeRawUnsafe(
        `UPDATE "permissions" SET "name" = $1, "description" = $2, "category" = $3, "scope" = $4::"PermissionScope", "is_system" = true WHERE "id" = $5`,
        perm.name,
        perm.description,
        perm.category,
        perm.scope,
        id
      );
    } else {
      id = `perm_${perm.code.replace(/[^a-zA-Z0-9]/g, "_")}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "permissions" ("id", "code", "name", "description", "category", "scope", "is_system")
         VALUES ($1, $2, $3, $4, $5, $6::"PermissionScope", true)`,
        id,
        perm.code,
        perm.name,
        perm.description,
        perm.category,
        perm.scope
      );
    }
    permissionIdMap.set(perm.code, id);
  }
  console.log(`✅ ${ALL_PERMISSIONS.length} permissions upserted.`);

  // 3. Seed Global System Roles
  console.log("🛡️ 3. Upserting global system roles...");
  const roleIdMap = new Map<string, string>();

  for (const roleDef of SYSTEM_GLOBAL_ROLES) {
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "roles" WHERE "slug" = $1 AND "scope" = 'GLOBAL' AND "scope_id" IS NULL LIMIT 1`,
      roleDef.slug
    );

    let roleId: string;
    if (existing && existing.length > 0) {
      roleId = existing[0].id;
      await prisma.$executeRawUnsafe(
        `UPDATE "roles" SET "name" = $1, "description" = $2, "color" = $3, "icon" = $4, "priority" = $5, "is_system" = true WHERE "id" = $6`,
        roleDef.name,
        roleDef.description,
        roleDef.color,
        roleDef.icon,
        roleDef.priority,
        roleId
      );
    } else {
      roleId = `role_sys_${roleDef.slug}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "roles" ("id", "name", "slug", "description", "scope", "scope_id", "is_system", "color", "icon", "priority")
         VALUES ($1, $2, $3, $4, 'GLOBAL'::"RoleScope", NULL, true, $5, $6, $7)`,
        roleId,
        roleDef.name,
        roleDef.slug,
        roleDef.description,
        roleDef.color,
        roleDef.icon,
        roleDef.priority
      );
    }
    roleIdMap.set(roleDef.slug, roleId);

    // Link Role Permissions
    for (const code of roleDef.permissionCodes) {
      const permId = permissionIdMap.get(code);
      if (permId) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
           VALUES ($1, $2, $3)
           ON CONFLICT ("role_id", "permission_id") DO NOTHING`,
          `rp_${roleId}_${permId}`,
          roleId,
          permId
        );
      }
    }
  }

  // 4. Seed Standard Club-Scoped Roles
  console.log("🏍️ 4. Upserting standard club-scoped roles...");
  for (const roleDef of STANDARD_CLUB_ROLES) {
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "roles" WHERE "slug" = $1 AND "scope" = 'CLUB' AND "scope_id" IS NULL LIMIT 1`,
      roleDef.slug
    );

    let roleId: string;
    if (existing && existing.length > 0) {
      roleId = existing[0].id;
      await prisma.$executeRawUnsafe(
        `UPDATE "roles" SET "name" = $1, "description" = $2, "color" = $3, "icon" = $4, "priority" = $5, "is_system" = true WHERE "id" = $6`,
        roleDef.name,
        roleDef.description,
        roleDef.color,
        roleDef.icon,
        roleDef.priority,
        roleId
      );
    } else {
      roleId = `role_club_${roleDef.slug}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "roles" ("id", "name", "slug", "description", "scope", "scope_id", "is_system", "color", "icon", "priority")
         VALUES ($1, $2, $3, $4, 'CLUB'::"RoleScope", NULL, true, $5, $6, $7)`,
        roleId,
        roleDef.name,
        roleDef.slug,
        roleDef.description,
        roleDef.color,
        roleDef.icon,
        roleDef.priority
      );
    }
    roleIdMap.set(`club:${roleDef.slug}`, roleId);

    for (const code of roleDef.permissionCodes) {
      const permId = permissionIdMap.get(code);
      if (permId) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
           VALUES ($1, $2, $3)
           ON CONFLICT ("role_id", "permission_id") DO NOTHING`,
          `rp_${roleId}_${permId}`,
          roleId,
          permId
        );
      }
    }
  }

  // 5. Migrate existing UserRoleAssignment rows to link to Role
  console.log("🔄 5. Migrating user_role_assignments from enum to Role records...");
  const enumToSlugMap: Record<string, string> = {
    ADMIN: "admin",
    CO_ADMIN: "co_admin",
    MODERATOR: "moderator",
    CLUB_OWNER: "club_owner",
    CLUB_ADMIN: "club_admin",
    CLUB_MODERATOR: "club_moderator",
    BRAND_OWNER: "brand_owner",
    BRAND_ADMIN: "brand_admin",
    BRAND_MODERATOR: "brand_moderator",
    RIDER: "rider",
    SELLER: "seller",
  };

  for (const [enumVal, slug] of Object.entries(enumToSlugMap)) {
    const roleId = roleIdMap.get(slug);
    if (roleId) {
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE "user_role_assignments"
         SET "role_id" = $1
         WHERE "role"::text = $2 AND ("role_id" IS NULL OR "role_id" != $1)`,
        roleId,
        enumVal
      );
      if (updated > 0) {
        console.log(`  ✓ Linked ${updated} '${enumVal}' assignment(s) to role '${slug}' (${roleId})`);
      }
    }
  }

  // 6. Backfill existing club_members role_id
  console.log("👥 6. Backfilling club_members custom role links...");
  const clubRoleMap: Record<string, string> = {
    FOUNDER: "club:founder",
    ADMIN: "club:club_admin",
    OFFICER: "club:officer",
    MEMBER: "club:member",
  };

  for (const [memberRole, roleKey] of Object.entries(clubRoleMap)) {
    const roleId = roleIdMap.get(roleKey);
    if (roleId) {
      await prisma.$executeRawUnsafe(
        `UPDATE "club_members"
         SET "role_id" = $1
         WHERE "role"::text = $2 AND "role_id" IS NULL`,
        roleId,
        memberRole
      );
    }
  }

  console.log("🎉 [RBAC Migration] Completed successfully!");
}

// Run directly if executed as script
if (process.argv[1]?.endsWith("migrate-rbac-and-custom-roles.ts")) {
  runRbacMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Migration failed:", err);
      process.exit(1);
    });
}
