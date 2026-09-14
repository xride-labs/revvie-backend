import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma.js";
import { ApiResponse } from "../../lib/utils/apiResponse.js";
import { asyncHandler } from "../../middlewares/validation.js";
import { requireAdmin, requireSuperAdmin } from "../../middlewares/rbac.js";
import { RolesService } from "../../services/roles.service.js";

const router = Router();

// Gated for Super Admin
router.use(requireAdmin);

/**
 * GET /api/admin/roles
 * List all global roles and system roles
 */
router.get(
  "/roles",
  asyncHandler(async (req: Request, res: Response) => {
    const roles = await prisma.role.findMany({
      where: { scope: { in: ["GLOBAL", "BUSINESS"] } },
      include: {
        permissions: {
          include: { permission: true },
        },
        _count: { select: { assignments: true } },
      },
      orderBy: [{ isSystem: "desc" }, { priority: "desc" }, { name: "asc" }],
    });

    const result = roles.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      scope: r.scope,
      scopeId: r.scopeId,
      isSystem: r.isSystem,
      color: r.color,
      icon: r.icon,
      priority: r.priority,
      userCount: r._count.assignments,
      permissions: r.permissions.map((p) => ({
        code: p.permission.code,
        name: p.permission.name,
        category: p.permission.category,
      })),
    }));

    ApiResponse.success(res, { roles: result });
  }),
);

/**
 * GET /api/admin/permissions
 * List all registered infrastructure permissions
 */
router.get(
  "/permissions",
  asyncHandler(async (req: Request, res: Response) => {
    const permissions = await prisma.permission.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    ApiResponse.success(res, { permissions });
  }),
);

/**
 * POST /api/admin/roles
 * Create a new global or business role
 */
router.post(
  "/roles",
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { name, slug, description, scope = "GLOBAL", scopeId, color, icon, priority = 0, permissionCodes = [] } = req.body;

    if (!name || !slug) {
      return ApiResponse.error(res, "Name and slug are required", 400);
    }

    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9_]/g, "_");

    const perms = await prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
    });

    const role = await prisma.role.create({
      data: {
        name,
        slug: cleanSlug,
        description,
        scope,
        scopeId: scopeId || null,
        isSystem: false,
        color: color || "#f97316",
        icon: icon || "shield",
        priority,
        permissions: {
          create: perms.map((p) => ({ permissionId: p.id })),
        },
      },
      include: {
        permissions: { include: { permission: true } },
      },
    });

    ApiResponse.created(res, { role }, "Role created successfully");
  }),
);

/**
 * PATCH /api/admin/roles/:roleId
 * Update a role
 */
router.patch(
  "/roles/:roleId",
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { roleId } = req.params;
    const { name, description, color, icon, priority, permissionCodes } = req.body;

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      return ApiResponse.notFound(res, "Role not found");
    }

    if (permissionCodes && Array.isArray(permissionCodes)) {
      await prisma.rolePermission.deleteMany({ where: { roleId } });
      const perms = await prisma.permission.findMany({
        where: { code: { in: permissionCodes } },
      });
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId, permissionId: p.id })),
      });
    }

    const updated = await prisma.role.update({
      where: { id: roleId },
      data: {
        name: name ?? role.name,
        description: description !== undefined ? description : role.description,
        color: color ?? role.color,
        icon: icon ?? role.icon,
        priority: priority ?? role.priority,
      },
      include: {
        permissions: { include: { permission: true } },
      },
    });

    ApiResponse.success(res, { role: updated }, "Role updated successfully");
  }),
);

/**
 * DELETE /api/admin/roles/:roleId
 * Delete a custom role
 */
router.delete(
  "/roles/:roleId",
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { roleId } = req.params;

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      return ApiResponse.notFound(res, "Role not found");
    }

    if (role.isSystem) {
      return ApiResponse.forbidden(res, "System roles cannot be deleted");
    }

    await prisma.role.delete({ where: { id: roleId } });
    ApiResponse.success(res, null, "Role deleted successfully");
  }),
);

/**
 * POST /api/admin/permissions
 * Register a new infrastructure permission
 */
router.post(
  "/permissions",
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { code, name, description, category, scope = "SYSTEM" } = req.body;

    if (!code || !name || !category) {
      return ApiResponse.error(res, "Code, name, and category are required", 400);
    }

    const permission = await prisma.permission.create({
      data: {
        code,
        name,
        description,
        category,
        scope,
        isSystem: false,
      },
    });

    ApiResponse.created(res, { permission }, "Permission created successfully");
  }),
);

/**
 * POST /api/admin/users/:userId/roles
 * Assign roles to a user
 */
router.post(
  "/users/:userId/roles",
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { roleSlugs } = req.body;
    const session = (req as any).session;

    if (!Array.isArray(roleSlugs)) {
      return ApiResponse.error(res, "roleSlugs must be an array of strings", 400);
    }

    // Remove existing and re-assign
    await prisma.userRoleAssignment.deleteMany({ where: { userId } });

    for (const slug of roleSlugs) {
      await RolesService.assignRoleToUser(userId, slug, session.user.id);
    }

    RolesService.clearUserCache(userId);

    const userWithRoles = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { roleRecord: true },
        },
      },
    });

    ApiResponse.success(res, { user: userWithRoles }, "User roles updated successfully");
  }),
);

export default router;
