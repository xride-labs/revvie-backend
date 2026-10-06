import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  tenantMiddleware,
  requireTenant,
  requireTenantAccess,
  requireTenantPermission,
  verifyTenantOwnership,
} from "./tenant.js";
import { TenantService } from "../services/tenant.service.js";

describe("Tenant Middlewares", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = {
      headers: {},
      params: {},
      body: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
    vi.clearAllMocks();
  });

  describe("tenantMiddleware", () => {
    it("attaches resolved tenant context to req.tenant", async () => {
      req.headers.host = "ktm-bangalore.revvie.app";

      vi.spyOn(TenantService, "resolveFromHost").mockResolvedValueOnce({
        found: true,
        tenant: {
          type: "CLUB",
          organizationId: "org-123",
          slug: "ktm-bangalore",
          name: "KTM Bangalore",
          status: "ACTIVE",
          isPlatform: false,
          isConsumer: false,
          clubId: "club-123",
        },
      });

      await tenantMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.tenant).toBeDefined();
      expect(req.tenant.organizationId).toBe("org-123");
      expect(req.tenant.type).toBe("CLUB");
    });
  });

  describe("requireTenant", () => {
    it("returns 404 when tenant is not found or is consumer", () => {
      req.tenant = { type: "CONSUMER", isConsumer: true, isPlatform: false };

      requireTenant(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when tenant is suspended or archived", () => {
      req.tenant = {
        type: "CLUB",
        organizationId: "org-1",
        status: "ARCHIVED",
        isPlatform: false,
        isConsumer: false,
      };

      requireTenant(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("calls next when tenant is active", () => {
      req.tenant = {
        type: "CLUB",
        organizationId: "org-1",
        status: "ACTIVE",
        isPlatform: false,
        isConsumer: false,
      };

      requireTenant(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("requireTenantAccess", () => {
    it("returns 401 when unauthenticated", async () => {
      req.tenant = { type: "CLUB", organizationId: "org-1", status: "ACTIVE" };
      req.session = null;

      await requireTenantAccess(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when user is not member of tenant", async () => {
      req.tenant = { type: "CLUB", organizationId: "org-1", status: "ACTIVE" };
      req.session = { user: { id: "user-1" } };

      vi.spyOn(TenantService, "getMembership").mockResolvedValueOnce(null);

      await requireTenantAccess(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("calls next when user is member of tenant", async () => {
      req.tenant = { type: "CLUB", organizationId: "org-1", status: "ACTIVE" };
      req.session = { user: { id: "user-1" } };

      vi.spyOn(TenantService, "getMembership").mockResolvedValueOnce({
        id: "mem-1",
        organizationId: "org-1",
        userId: "user-1",
        roleId: "role-1",
        status: "ACTIVE",
        role: {
          slug: "admin",
          permissions: [],
        },
      } as any);

      await requireTenantAccess(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.tenantMembership).toBeDefined();
    });
  });

  describe("verifyTenantOwnership (IDOR Prevention)", () => {
    it("returns 403 when request body clubId does not match tenant clubId", () => {
      req.tenant = {
        type: "CLUB",
        organizationId: "org-1",
        clubId: "club-1",
        status: "ACTIVE",
      };
      req.body.clubId = "club-2"; // Attacker attempts to modify club-2

      const guard = verifyTenantOwnership("club", "clubId");
      guard(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("calls next when request body clubId matches tenant clubId", () => {
      req.tenant = {
        type: "CLUB",
        organizationId: "org-1",
        clubId: "club-1",
        status: "ACTIVE",
      };
      req.body.clubId = "club-1";

      const guard = verifyTenantOwnership("club", "clubId");
      guard(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
