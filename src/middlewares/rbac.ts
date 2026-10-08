import { Request, Response, NextFunction } from "express";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
import {
  UserRole,
  hasAnyRole,
  isAdmin,
  WEB_ACCESS_ROLES,
  MOBILE_ACCESS_ROLES,
} from "../lib/utils/permissions.js";
import prisma from "../lib/prisma.js";

// Re-export for backward compatibility
export { UserRole, WEB_ACCESS_ROLES, MOBILE_ACCESS_ROLES };

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Fetch a user's roles from the DB as a UserRole[].
 * Returns the assigned roles as-is.
 */
export async function getUserRoles(userId: string): Promise<UserRole[]> {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: { userId },
    select: { roleRecord: true },
  });
  return assignments.map((a) => a.roleRecord.slug.toUpperCase() as UserRole);
}

// ─── Middleware factories ────────────────────────────────────────────

/**
 * Require that the authenticated user holds **any** of the listed roles.
 *
 * @deprecated Slug/role-list path is a legacy shim. Prefer permission-code gates:
 * `requirePermission(...)` for global permissions or `requireBusinessPermission(...)`
 * (and `requireClubPermission(...)` for clubs) backed by `RolesService.hasPermission`.
 * This function is frozen — no new call sites; runtime behavior unchanged.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).session;

    if (!session?.user) {
      return ApiResponse.unauthorized(res, "Authentication required");
    }

    const userRoles = await getUserRoles(session.user.id);

    if (!hasAnyRole(userRoles, allowedRoles)) {
      return ApiResponse.forbidden(
        res,
        `This action requires one of the following roles: ${allowedRoles.join(", ")}`,
        ErrorCode.ROLE_REQUIRED,
      );
    }

    (req as any).userRoles = userRoles;
    next();
  };
}

// ─── Pre-built guards ────────────────────────────────────────────────

export const requireAdmin = requireRole(UserRole.ADMIN, UserRole.CO_ADMIN);
export const requireSuperAdmin = requireRole(UserRole.ADMIN);
export const requireClubOwnerOrAdmin = requireRole(
  UserRole.CLUB_OWNER,
  UserRole.CO_ADMIN,
  UserRole.ADMIN,
);

/**
 * Require web-portal access (ADMIN | CO_ADMIN | CLUB_OWNER | SELLER).
 */
export function requireWebAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  return requireRole(...WEB_ACCESS_ROLES)(req, res, next);
}

// ─── Ownership guards ───────────────────────────────────────────────

/**
 * Require resource ownership **or** admin access.
 */
export function requireOwnershipOrAdmin(
  resourceType: "ride" | "club" | "listing" | "post",
  resourceIdParam: string = "id",
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).session;
    const resourceId = req.params[resourceIdParam];

    if (!session?.user) {
      return ApiResponse.unauthorized(res, "Authentication required");
    }

    const userRoles = await getUserRoles(session.user.id);

    // Admins always pass
    if (isAdmin(userRoles)) {
      (req as any).userRoles = userRoles;
      return next();
    }

    // Check ownership
    let isOwner = false;

    switch (resourceType) {
      case "ride": {
        const ride = await prisma.ride.findUnique({
          where: { id: resourceId },
          select: { creatorId: true },
        });
        isOwner = ride?.creatorId === session.user.id;
        break;
      }
      case "club": {
        const club = await prisma.club.findUnique({
          where: { id: resourceId },
          select: { ownerId: true },
        });
        isOwner = club?.ownerId === session.user.id;
        if (!isOwner) {
          const membership = await prisma.clubMember.findUnique({
            where: {
              clubId_userId: {
                clubId: resourceId,
                userId: session.user.id,
              },
            },
            include: { role: true },
          });
          const slug = membership?.role?.slug?.toLowerCase();
          isOwner = slug === "owner" || slug === "founder" || slug === "admin";
        }
        break;
      }
      case "listing": {
        const listing = await prisma.marketplaceListing.findUnique({
          where: { id: resourceId },
          select: { sellerId: true },
        });
        isOwner = listing?.sellerId === session.user.id;
        break;
      }
      case "post": {
        const post = await prisma.post.findUnique({
          where: { id: resourceId },
          select: { authorId: true },
        });
        isOwner = post?.authorId === session.user.id;
        break;
      }
    }

    if (!isOwner) {
      return ApiResponse.forbidden(
        res,
        "You don't have permission to modify this resource",
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }

    (req as any).userRoles = userRoles;
    next();
  };
}

import { RolesService } from "../services/roles.service.js";

/**
 * Require a specific global permission (e.g. 'system:manage_users', 'rider:create_rides').
 */
export function requirePermission(...permissionCodes: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).session;
    if (!session?.user) {
      return ApiResponse.unauthorized(res, "Authentication required");
    }

    const userPerms = await RolesService.getUserPermissions(session.user.id);
    const hasPerm = permissionCodes.some((code) => userPerms.includes(code) || userPerms.includes("system:admin"));

    if (!hasPerm) {
      return ApiResponse.forbidden(
        res,
        `This action requires one of the following permissions: ${permissionCodes.join(", ")}`,
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }

    (req as any).userPermissions = userPerms;
    next();
  };
}

/**
 * Require a specific club permission (e.g. 'club:view_analytics', 'club:manage_roles').
 * Checks if user is club founder, holds a custom role with that permission, or is a system admin.
 */
export function requireClubPermission(permissionCode: string, clubIdParam: string = "id") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).session;
    const clubId = req.params[clubIdParam] || req.params.clubId || req.body.clubId;

    if (!session?.user) {
      return ApiResponse.unauthorized(res, "Authentication required");
    }

    if (!clubId) {
      return ApiResponse.error(res, "Club ID is required", 400, ErrorCode.MISSING_REQUIRED_FIELD);
    }

    const { permissions, role } = await RolesService.getClubPermissions(session.user.id, clubId);

    if (!permissions.includes(permissionCode)) {
      return ApiResponse.forbidden(
        res,
        `You do not have permission (${permissionCode}) to perform this action in this club`,
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }

    (req as any).clubPermissions = permissions;
    (req as any).clubCustomRole = role;
    next();
  };
}

/**
 * Require a specific business permission (e.g. 'business:view_analytics', 'business:manage_roles').
 * Checks if user is business owner, holds a custom role with that permission, or is a system admin.
 */
export function requireBusinessPermission(permissionCode: string, businessIdParam: string = "id") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).session;
    const businessId = req.params[businessIdParam] || req.params.businessId || req.body.businessId;

    if (!session?.user) {
      return ApiResponse.unauthorized(res, "Authentication required");
    }

    if (!businessId) {
      return ApiResponse.error(res, "Business ID is required", 400, ErrorCode.MISSING_REQUIRED_FIELD);
    }

    const { permissions, role } = await RolesService.getBusinessPermissions(session.user.id, businessId);

    if (!permissions.includes(permissionCode)) {
      return ApiResponse.forbidden(
        res,
        `You do not have permission (${permissionCode}) to perform this action in this business`,
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }

    (req as any).businessPermissions = permissions;
    (req as any).businessCustomRole = role;
    next();
  };
}

/**
 * Require club membership with a minimum role or equivalent custom permission.
 */
export function requireClubMembership(
  minRole: "MEMBER" | "OFFICER" | "ADMIN" | "FOUNDER" = "MEMBER",
  clubIdParam: string = "clubId",
) {
  const roleOrder = { MEMBER: 0, OFFICER: 1, ADMIN: 2, FOUNDER: 3 };

  return async (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).session;
    const clubId = req.params[clubIdParam] || req.params.id || req.body.clubId;

    if (!session?.user) {
      return ApiResponse.unauthorized(res, "Authentication required");
    }

    if (!clubId) {
      return ApiResponse.error(
        res,
        "Club ID is required",
        400,
        ErrorCode.MISSING_REQUIRED_FIELD,
      );
    }

    // Dynamic Club Permissions check
    const { permissions, role: customRole } = await RolesService.getClubPermissions(session.user.id, clubId);

    // If requiring ADMIN, check for administrative club permissions or system admin
    if (minRole === "ADMIN") {
      if (
        permissions.includes("system:admin") ||
        permissions.includes("club:manage_settings") ||
        permissions.includes("club:manage_roles") ||
        permissions.includes("club:manage_members")
      ) {
        (req as any).clubRole = "ADMIN";
        (req as any).clubPermissions = permissions;
        (req as any).clubCustomRole = customRole;
        return next();
      }
    } else if (minRole === "OFFICER") {
      if (
        permissions.includes("system:admin") ||
        permissions.includes("club:view_analytics") ||
        permissions.includes("club:manage_rides") ||
        permissions.includes("club:moderate_chat") ||
        permissions.includes("club:moderate_members")
      ) {
        (req as any).clubRole = "OFFICER";
        (req as any).clubPermissions = permissions;
        (req as any).clubCustomRole = customRole;
        return next();
      }
    }

    // Check base club membership
    const membership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: session.user.id } },
      include: { role: true },
    });

    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { ownerId: true },
    });

    const isOwner = club?.ownerId === session.user.id;

    if (!membership && !isOwner) {
      return ApiResponse.forbidden(res, "You are not a member of this club");
    }

    const memberRoleSlug = isOwner ? "owner" : (membership?.role?.slug?.toLowerCase() || "member");
    const roleMapping: Record<string, "MEMBER" | "OFFICER" | "ADMIN" | "FOUNDER"> = {
      owner: "FOUNDER",
      founder: "FOUNDER",
      admin: "ADMIN",
      officer: "OFFICER",
      ride_captain: "OFFICER",
      moderator: "OFFICER",
      member: "MEMBER",
    };
    const memberRole = roleMapping[memberRoleSlug] || "MEMBER";

    if (roleOrder[memberRole as keyof typeof roleOrder] < roleOrder[minRole]) {
      return ApiResponse.forbidden(
        res,
        `This action requires ${minRole} role or higher in the club`,
      );
    }

    (req as any).clubRole = memberRole;
    (req as any).clubPermissions = permissions;
    (req as any).clubCustomRole = customRole;
    next();
  };
}
