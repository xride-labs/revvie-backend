import prisma from "../lib/prisma.js";

// Cache permissions in-memory with a short TTL (10s) to keep API super fast while reflecting updates promptly
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const permissionCache = new Map<string, CacheEntry<string[]>>();
const clubPermissionCache = new Map<string, CacheEntry<{ permissions: string[]; role: any | null }>>();

const CACHE_TTL_MS = 10_000;

export class RolesService {
  /**
   * Invalidate cached permissions for a user
   */
  static clearUserCache(userId: string) {
    permissionCache.delete(userId);
    for (const key of clubPermissionCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        clubPermissionCache.delete(key);
      }
    }
  }

  /**
   * Invalidate cached permissions for all members of a club
   */
  static clearClubCache(clubId: string) {
    for (const key of clubPermissionCache.keys()) {
      if (key.endsWith(`:${clubId}`)) {
        clubPermissionCache.delete(key);
      }
    }
  }

  /**
   * Fetch all effective global permission codes for a user
   */
  static async getUserPermissions(userId: string): Promise<string[]> {
    const cached = permissionCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // 1. Get assignments with role and permissions
    const assignments = await prisma.userRoleAssignment.findMany({
      where: { userId },
      include: {
        roleRecord: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    const permissionSet = new Set<string>();

    for (const assignment of assignments) {
      if (assignment.roleRecord) {
        // If user has super_admin or admin, they get all permissions
        if (assignment.roleRecord.slug === "super_admin" || assignment.roleRecord.slug === "admin") {
          const allPerms = await prisma.permission.findMany({ select: { code: true } });
          const allCodes = allPerms.map((p) => p.code);
          permissionCache.set(userId, { data: allCodes, expiresAt: Date.now() + CACHE_TTL_MS });
          return allCodes;
        }

        for (const rp of assignment.roleRecord.permissions) {
          if (rp.permission?.code) {
            permissionSet.add(rp.permission.code);
          }
        }
      }
    }

    const result = Array.from(permissionSet);
    permissionCache.set(userId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  /**
   * Fetch all effective permissions for a user within a specific club context
   */
  static async getClubPermissions(
    userId: string,
    clubId: string
  ): Promise<{ permissions: string[]; role: { id?: string; name: string; slug: string; color?: string | null; icon?: string | null } | null }> {
    const cacheKey = `${userId}:${clubId}`;
    const cached = clubPermissionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // 1. Check if user is a global platform admin
    const globalPerms = await this.getUserPermissions(userId);
    if (globalPerms.includes("system:admin") || globalPerms.includes("system:manage_clubs")) {
      const allClubPerms = await prisma.permission.findMany({
        where: { scope: { in: ["CLUB", "SYSTEM"] } },
        select: { code: true },
      });
      const res = {
        permissions: allClubPerms.map((p) => p.code),
        role: { name: "Platform Admin", slug: "platform_admin", color: "#EF4444", icon: "shield-alert" },
      };
      clubPermissionCache.set(cacheKey, { data: res, expiresAt: Date.now() + CACHE_TTL_MS });
      return res;
    }

    // 2. Fetch club to check ownership
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { ownerId: true },
    });

    if (!club) {
      return { permissions: [], role: null };
    }

    // 3. If owner of the club -> Full Club Founder permissions
    if (club.ownerId === userId) {
      const founderRole = await prisma.role.findFirst({
        where: { slug: "founder", scope: "CLUB" },
        include: { permissions: { include: { permission: true } } },
      });
      const perms = founderRole
        ? founderRole.permissions.map((rp) => rp.permission.code)
        : [
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
          ];
      const res = {
        permissions: perms,
        role: {
          id: founderRole?.id,
          name: founderRole?.name || "Club Founder",
          slug: "founder",
          color: founderRole?.color || "#F59E0B",
          icon: founderRole?.icon || "crown",
        },
      };
      clubPermissionCache.set(cacheKey, { data: res, expiresAt: Date.now() + CACHE_TTL_MS });
      return res;
    }

    // 4. Fetch club membership
    const membership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId } },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    if (!membership || !membership.role) {
      return { permissions: [], role: null };
    }

    const perms = membership.role.permissions.map((rp) => rp.permission.code);
    const res = {
      permissions: perms,
      role: {
        id: membership.role.id,
        name: membership.role.name,
        slug: membership.role.slug,
        color: membership.role.color,
        icon: membership.role.icon,
      },
    };
    clubPermissionCache.set(cacheKey, { data: res, expiresAt: Date.now() + CACHE_TTL_MS });
    return res;
  }

  /**
   * Check if a user has a specific permission globally
   */
  static async hasPermission(userId: string, permissionCode: string): Promise<boolean> {
    const perms = await this.getUserPermissions(userId);
    return perms.includes(permissionCode) || perms.includes("system:admin");
  }

  /**
   * Check if a user has a specific permission in a club
   */
  static async hasClubPermission(
    userId: string,
    clubId: string,
    permissionCode: string
  ): Promise<boolean> {
    const { permissions } = await this.getClubPermissions(userId, clubId);
    return permissions.includes(permissionCode);
  }

  /**
   * Assign a system role to a user
   */
  static async assignRoleToUser(userId: string, roleSlug: string, assignedById?: string) {
    const role = await prisma.role.findFirst({
      where: { slug: roleSlug, scope: "GLOBAL" },
    });

    if (!role) {
      throw new Error(`Role '${roleSlug}' not found`);
    }

    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: {
        userId,
        roleId: role.id,
        assignedById: assignedById || null,
      },
      update: {
        assignedById: assignedById || null,
      },
    });

    this.clearUserCache(userId);
  }

  /**
   * Remove a role from a user
   */
  static async removeRoleFromUser(userId: string, roleSlug: string) {
    const role = await prisma.role.findFirst({
      where: { slug: roleSlug, scope: "GLOBAL" },
    });

    if (role) {
      await prisma.userRoleAssignment.deleteMany({
        where: { userId, roleId: role.id },
      });
      this.clearUserCache(userId);
    }
  }

  /**
   * List all roles available for a club (System Club Roles + Custom Club Roles)
   */
  static async listClubRoles(clubId: string) {
    const [systemClubRoles, customClubRoles] = await Promise.all([
      prisma.role.findMany({
        where: { scope: "CLUB", scopeId: null },
        include: {
          permissions: {
            include: { permission: true },
          },
          _count: { select: { clubMembers: { where: { clubId } } } },
        },
        orderBy: { priority: "desc" },
      }),
      prisma.role.findMany({
        where: { scope: "CLUB", scopeId: clubId },
        include: {
          permissions: {
            include: { permission: true },
          },
          _count: { select: { clubMembers: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return [...systemClubRoles, ...customClubRoles].map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      color: r.color,
      icon: r.icon,
      priority: r.priority,
      isSystem: r.isSystem,
      scope: r.scope,
      scopeId: r.scopeId,
      permissions: r.permissions.map((p) => ({
        code: p.permission.code,
        name: p.permission.name,
        category: p.permission.category,
      })),
      memberCount: (r as any)._count?.clubMembers || 0,
    }));
  }

  /**
   * List all available permissions that can be granted to club roles
   */
  static async listClubPermissions() {
    return await prisma.permission.findMany({
      where: { scope: "CLUB" },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }

  /**
   * Create a custom role for a club
   */
  static async createClubRole(
    clubId: string,
    data: {
      name: string;
      description?: string;
      color?: string;
      icon?: string;
      permissionCodes: string[];
    }
  ) {
    const slug = `${data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now().toString(36)}`;

    // Validate permission codes
    const permissions = await prisma.permission.findMany({
      where: {
        code: { in: data.permissionCodes },
        scope: "CLUB",
      },
    });

    const role = await prisma.role.create({
      data: {
        name: data.name,
        slug,
        description: data.description,
        color: data.color || "#3B82F6",
        icon: data.icon || "shield",
        scope: "CLUB",
        scopeId: clubId,
        isSystem: false,
        priority: 50,
        permissions: {
          create: permissions.map((p) => ({
            permissionId: p.id,
          })),
        },
      },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });

    this.clearClubCache(clubId);
    return role;
  }

  /**
   * Update a custom role for a club
   */
  static async updateClubRole(
    clubId: string,
    roleId: string,
    data: {
      name?: string;
      description?: string;
      color?: string;
      icon?: string;
      permissionCodes?: string[];
    }
  ) {
    const role = await prisma.role.findFirst({
      where: { id: roleId, scope: "CLUB", scopeId: clubId },
    });

    if (!role) {
      throw new Error("Custom role not found");
    }

    if (role.isSystem) {
      throw new Error("System roles cannot be modified");
    }

    // Update permissions if provided
    if (data.permissionCodes) {
      await prisma.rolePermission.deleteMany({ where: { roleId } });
      const perms = await prisma.permission.findMany({
        where: { code: { in: data.permissionCodes }, scope: "CLUB" },
      });
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId, permissionId: p.id })),
      });
    }

    const updated = await prisma.role.update({
      where: { id: roleId },
      data: {
        name: data.name ?? role.name,
        description: data.description !== undefined ? data.description : role.description,
        color: data.color ?? role.color,
        icon: data.icon ?? role.icon,
      },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });

    this.clearClubCache(clubId);
    return updated;
  }

  /**
   * Delete a custom role for a club
   */
  static async deleteClubRole(clubId: string, roleId: string) {
    const role = await prisma.role.findFirst({
      where: { id: roleId, scope: "CLUB", scopeId: clubId },
    });

    if (!role) {
      throw new Error("Role not found");
    }

    if (role.isSystem) {
      throw new Error("System-defined roles cannot be deleted");
    }

    // Reassign any members using this role to standard member
    const memberRole = await prisma.role.findFirst({
      where: { scope: "CLUB", slug: "member" },
      select: { id: true },
    });
    if (memberRole) {
      await prisma.clubMember.updateMany({
        where: { clubId, roleId },
        data: { roleId: memberRole.id },
      });
    }

    await prisma.role.delete({ where: { id: roleId } });
    this.clearClubCache(clubId);
  }

  /**
   * Assign a role to a club member
   */
  static async assignClubMemberRole(clubId: string, userId: string, roleId: string | null) {
    let targetRoleId = roleId;

    if (!targetRoleId) {
      const defaultRole = await prisma.role.findFirst({
        where: { scope: "CLUB", slug: "member" },
        select: { id: true },
      });
      targetRoleId = defaultRole?.id || null;
    } else {
      const role = await prisma.role.findFirst({
        where: {
          id: targetRoleId,
          scope: "CLUB",
          OR: [{ scopeId: null }, { scopeId: clubId }],
        },
      });

      if (!role) {
        throw new Error("Role not found for this club");
      }
      targetRoleId = role.id;
    }

    if (!targetRoleId) {
      throw new Error("Member role could not be resolved");
    }

    const updatedMember = await prisma.clubMember.update({
      where: { clubId_userId: { clubId, userId } },
      data: {
        roleId: targetRoleId,
      },
      include: {
        role: true,
        user: { select: { id: true, name: true, avatar: true } },
      },
    });

    this.clearClubCache(clubId);
    return updatedMember;
  }
}
