import { Request, Response, NextFunction } from "express";
import { TenantService, TenantContext } from "../services/tenant.service.js";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
import { RolesService } from "../services/roles.service.js";

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      tenantMembership?: any;
    }
  }
}

/**
 * Middleware that resolves tenant context from request headers and attaches it to req.tenant.
 */
export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantSlug = req.headers["x-tenant-slug"] as string | undefined;
    if (tenantSlug) {
      const result = await TenantService.resolveBySlug(tenantSlug);
      req.tenant = result.tenant;
      return next();
    }

    const host =
      (req.headers["x-tenant-host"] as string) ||
      (req.headers["x-forwarded-host"] as string) ||
      req.headers.host ||
      "";

    const result = await TenantService.resolveFromHost(host);
    req.tenant = result.tenant;
    next();
  } catch (error) {
    console.error("[TENANT_MIDDLEWARE] Resolution error:", error);
    req.tenant = {
      type: "CONSUMER",
      isConsumer: true,
      isPlatform: false,
    };
    next();
  }
}

/**
 * Guard requiring that the request is addressed to a valid, active tenant (not root consumer).
 */
export function requireTenant(req: Request, res: Response, next: NextFunction) {
  const tenant = req.tenant;

  if (!tenant || tenant.isConsumer || !tenant.organizationId) {
    return ApiResponse.notFound(res, "Tenant not found");
  }

  if (tenant.status === "SUSPENDED" || tenant.status === "ARCHIVED") {
    return ApiResponse.forbidden(
      res,
      `Tenant is currently ${tenant.status.toLowerCase()}`,
      ErrorCode.INSUFFICIENT_PERMISSIONS,
    );
  }

  next();
}

/**
 * Guard requiring that the authenticated user is a member of the current tenant.
 */
export async function requireTenantAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const tenant = req.tenant;
  const session = (req as any).session;

  if (!tenant || !tenant.organizationId) {
    return ApiResponse.notFound(res, "Tenant not found");
  }

  if (!session?.user) {
    return ApiResponse.unauthorized(res, "Authentication required");
  }

  // System admin bypass
  const globalPerms = await RolesService.getUserPermissions(session.user.id);
  if (globalPerms.includes("system:admin")) {
    return next();
  }

  const membership = await TenantService.getMembership(
    session.user.id,
    tenant.organizationId,
  );

  if (!membership || membership.status !== "ACTIVE") {
    return ApiResponse.forbidden(
      res,
      "You are not an active member of this organization",
      ErrorCode.INSUFFICIENT_PERMISSIONS,
    );
  }

  req.tenantMembership = membership;
  next();
}

/**
 * Guard requiring a specific permission within the tenant context.
 */
export function requireTenantPermission(...permissionCodes: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    await requireTenantAccess(req, res, async () => {
      const session = (req as any).session;
      const membership = req.tenantMembership;

      // Platform admin bypass
      const globalPerms = await RolesService.getUserPermissions(session.user.id);
      if (globalPerms.includes("system:admin")) {
        return next();
      }

      if (!membership || !membership.role) {
        return ApiResponse.forbidden(res, "Insufficient permissions");
      }

      const assignedPerms = (membership.role.permissions || []).map(
        (rp: any) => rp.permission?.code || rp.code,
      );

      const hasPerm = permissionCodes.some((code) =>
        assignedPerms.includes(code),
      );

      if (!hasPerm) {
        return ApiResponse.forbidden(
          res,
          `This action requires one of the following permissions: ${permissionCodes.join(", ")}`,
          ErrorCode.INSUFFICIENT_PERMISSIONS,
        );
      }

      next();
    });
  };
}

/**
 * IDOR Prevention: Verifies that any resource ID in request payload/params matches the current tenant.
 */
export function verifyTenantOwnership(
  resourceType: "club" | "business",
  idParam: string = "id",
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const tenant = req.tenant;
    if (!tenant) return next();

    const targetId =
      req.params[idParam] || req.body[idParam] || req.query[idParam];

    if (!targetId) return next();

    if (resourceType === "club" && tenant.clubId) {
      if (targetId !== tenant.clubId) {
        return ApiResponse.forbidden(
          res,
          "Target club does not match the active tenant",
          ErrorCode.INSUFFICIENT_PERMISSIONS,
        );
      }
    }

    if (resourceType === "business" && tenant.businessId) {
      if (targetId !== tenant.businessId) {
        return ApiResponse.forbidden(
          res,
          "Target business does not match the active tenant",
          ErrorCode.INSUFFICIENT_PERMISSIONS,
        );
      }
    }

    next();
  };
}
