import { Router, Request, Response } from "express";
import { TenantService } from "../../services/tenant.service.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { tenantMiddleware, requireTenant, requireTenantAccess } from "../../middlewares/tenant.js";

const router = Router();

/**
 * GET /api/tenant/resolve
 * Public resolver used by Next.js proxy/BFF and frontend to look up tenant metadata from hostname or slug.
 */
router.get("/resolve", async (req: Request, res: Response) => {
  const hostname = req.query.hostname as string | undefined;
  const slug = req.query.slug as string | undefined;

  if (slug) {
    const result = await TenantService.resolveBySlug(slug);
    return ApiResponse.success(res, result);
  }

  const hostToResolve =
    hostname ||
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers["x-tenant-host"] as string) ||
    req.headers.host ||
    "";

  const result = await TenantService.resolveFromHost(hostToResolve);
  return ApiResponse.success(res, result);
});

/**
 * GET /api/tenant/me
 * Returns authenticated user's membership and permissions in the resolved tenant.
 */
router.get(
  "/me",
  tenantMiddleware,
  requireTenant,
  requireTenantAccess,
  async (req: Request, res: Response) => {
    const session = (req as any).session;
    const tenant = req.tenant;

    if (!session?.user || !tenant?.organizationId) {
      return ApiResponse.unauthorized(res, "Authentication required");
    }

    const membership = await TenantService.getMembership(
      session.user.id,
      tenant.organizationId,
    );

    return ApiResponse.success(res, {
      tenant,
      membership,
    });
  },
);

export default router;
