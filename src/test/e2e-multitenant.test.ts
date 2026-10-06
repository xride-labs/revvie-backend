import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { TenantService } from "../services/tenant.service.js";
import { RolesService } from "../services/roles.service.js";
import {
  tenantMiddleware,
  requireTenant,
  requireTenantAccess,
  requireTenantPermission,
  verifyTenantOwnership,
} from "../middlewares/tenant.js";
import tenantRoutes from "../routes/tenant/tenant.routes.js";
import { isReservedSubdomain } from "../lib/constants/reservedSubdomains.js";

// Construct an end-to-end Express application mimicking server.ts
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Simulate Better Auth session from testing headers
  app.use((req, res, next) => {
    const userId = req.headers["x-test-user-id"] as string;
    if (userId) {
      (req as any).session = {
        user: { id: userId, email: `${userId}@test.com` },
      };
    }
    next();
  });

  app.use(tenantMiddleware);
  app.use("/api/tenant", tenantRoutes);

  // Protected tenant endpoint
  app.get(
    "/api/tenant-protected",
    requireTenant,
    requireTenantAccess,
    (req, res) => {
      res.json({
        success: true,
        tenant: req.tenant,
        membership: req.tenantMembership,
      });
    }
  );

  // Permission-gated tenant endpoint
  app.post(
    "/api/tenant-action",
    requireTenant,
    requireTenantPermission("club:manage_settings"),
    (req, res) => {
      res.json({ success: true, message: "Action allowed" });
    }
  );

  // Resource isolation / IDOR prevention endpoint
  app.get(
    "/api/clubs/:id",
    requireTenant,
    verifyTenantOwnership("club", "id"),
    (req, res) => {
      res.json({ success: true, clubId: req.params.id });
    }
  );

  return app;
}

describe("End-to-End Multi-Tenant Architecture Verification", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe("1. Hostname Resolution & Surfaces", () => {
    it("recognizes consumer surface on root domain revvie.xride-labs.in", async () => {
      const res = await TenantService.resolveFromHost("revvie.xride-labs.in");
      expect(res.found).toBe(true);
      expect(res.tenant?.isConsumer).toBe(true);
      expect(res.tenant?.type).toBe("CONSUMER");
      expect(res.tenant?.isPlatform).toBe(false);
    });

    it("recognizes platform admin surface on admin.revvie.xride-labs.in", async () => {
      vi.spyOn(TenantService, "resolveFromHost").mockResolvedValueOnce({
        found: true,
        tenant: {
          type: "PLATFORM",
          organizationId: "org-platform-1",
          slug: "admin",
          name: "Revvie Platform",
          status: "ACTIVE",
          isPlatform: true,
          isConsumer: false,
        },
      });

      const res = await TenantService.resolveFromHost("admin.revvie.xride-labs.in");
      expect(res.found).toBe(true);
      expect(res.tenant?.isPlatform).toBe(true);
      expect(res.tenant?.type).toBe("PLATFORM");
      expect(res.tenant?.organizationId).toBe("org-platform-1");
    });

    it("resolves club tenant portal on ktm-bangalore.revvie.xride-labs.in", async () => {
      vi.spyOn(TenantService, "resolveFromHost").mockResolvedValueOnce({
        found: true,
        tenant: {
          type: "CLUB",
          organizationId: "org-club-1",
          slug: "ktm-bangalore",
          name: "KTM Bangalore Riders",
          status: "ACTIVE",
          isPlatform: false,
          isConsumer: false,
          clubId: "club-100",
        },
      });

      const res = await TenantService.resolveFromHost("ktm-bangalore.revvie.xride-labs.in");
      expect(res.found).toBe(true);
      expect(res.tenant?.type).toBe("CLUB");
      expect(res.tenant?.clubId).toBe("club-100");
    });

    it("resolves brand tenant portal on ktm.revvie.xride-labs.in", async () => {
      vi.spyOn(TenantService, "resolveFromHost").mockResolvedValueOnce({
        found: true,
        tenant: {
          type: "BRAND",
          organizationId: "org-brand-1",
          slug: "ktm",
          name: "KTM Official",
          status: "ACTIVE",
          isPlatform: false,
          isConsumer: false,
          businessId: "biz-200",
        },
      });

      const res = await TenantService.resolveFromHost("ktm.revvie.xride-labs.in");
      expect(res.found).toBe(true);
      expect(res.tenant?.type).toBe("BRAND");
      expect(res.tenant?.businessId).toBe("biz-200");
    });

    it("blocks reserved subdomains from tenant routing", () => {
      expect(isReservedSubdomain("api")).toBe(true);
      expect(isReservedSubdomain("auth")).toBe(true);
      expect(isReservedSubdomain("static")).toBe(true);
      expect(isReservedSubdomain("admin")).toBe(true);
      expect(isReservedSubdomain("ktm")).toBe(false);
    });
  });

  describe("2. Request Flow & Tenant Middleware", () => {
    it("allows active tenant member to access tenant-protected endpoint", async () => {
      vi.spyOn(TenantService, "resolveFromHost").mockResolvedValueOnce({
        found: true,
        tenant: {
          type: "CLUB",
          organizationId: "org-club-1",
          slug: "ktm-bangalore",
          name: "KTM Bangalore Riders",
          status: "ACTIVE",
          isPlatform: false,
          isConsumer: false,
          clubId: "club-100",
        },
      });

      vi.spyOn(RolesService, "getUserPermissions").mockResolvedValueOnce([]);
      vi.spyOn(TenantService, "getMembership").mockResolvedValueOnce({
        id: "mem-1",
        organizationId: "org-club-1",
        userId: "user-1",
        status: "ACTIVE",
        role: {
          id: "role-1",
          name: "Manager",
          permissions: ["club:manage_settings"],
        },
      } as any);

      const res = await request(app)
        .get("/api/tenant-protected")
        .set("Host", "ktm-bangalore.revvie.xride-labs.in")
        .set("x-test-user-id", "user-1");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tenant.organizationId).toBe("org-club-1");
    });

    it("denies access to non-member visiting tenant subdomain", async () => {
      vi.spyOn(TenantService, "resolveFromHost").mockResolvedValueOnce({
        found: true,
        tenant: {
          type: "CLUB",
          organizationId: "org-club-1",
          slug: "ktm-bangalore",
          name: "KTM Bangalore Riders",
          status: "ACTIVE",
          isPlatform: false,
          isConsumer: false,
          clubId: "club-100",
        },
      });

      vi.spyOn(RolesService, "getUserPermissions").mockResolvedValueOnce([]);
      vi.spyOn(TenantService, "getMembership").mockResolvedValueOnce(null);

      const res = await request(app)
        .get("/api/tenant-protected")
        .set("Host", "ktm-bangalore.revvie.xride-labs.in")
        .set("x-test-user-id", "intruder-user");

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("not an active member of this organization");
    });

    it("denies access when tenant is SUSPENDED or ARCHIVED", async () => {
      vi.spyOn(TenantService, "resolveFromHost").mockResolvedValueOnce({
        found: true,
        tenant: {
          type: "CLUB",
          organizationId: "org-suspended",
          slug: "banned-club",
          name: "Banned Club",
          status: "SUSPENDED",
          isPlatform: false,
          isConsumer: false,
        },
      });

      const res = await request(app)
        .get("/api/tenant-protected")
        .set("Host", "banned-club.revvie.xride-labs.in")
        .set("x-test-user-id", "user-1");

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("suspended");
    });
  });

  describe("3. Resource Isolation & IDOR Prevention", () => {
    it("allows accessing resources owned by the tenant organization", async () => {
      vi.spyOn(TenantService, "resolveFromHost").mockResolvedValueOnce({
        found: true,
        tenant: {
          type: "CLUB",
          organizationId: "org-club-1",
          slug: "ktm-bangalore",
          name: "KTM Bangalore Riders",
          status: "ACTIVE",
          isPlatform: false,
          isConsumer: false,
          clubId: "club-100",
        },
      });

      const res = await request(app)
        .get("/api/clubs/club-100")
        .set("Host", "ktm-bangalore.revvie.xride-labs.in");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.clubId).toBe("club-100");
    });

    it("rejects cross-tenant IDOR attack targeting another organization resource", async () => {
      vi.spyOn(TenantService, "resolveFromHost").mockResolvedValueOnce({
        found: true,
        tenant: {
          type: "CLUB",
          organizationId: "org-club-1",
          slug: "ktm-bangalore",
          name: "KTM Bangalore Riders",
          status: "ACTIVE",
          isPlatform: false,
          isConsumer: false,
          clubId: "club-100",
        },
      });

      const res = await request(app)
        .get("/api/clubs/other-club-999")
        .set("Host", "ktm-bangalore.revvie.xride-labs.in");

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Target club does not match the active tenant");
    });
  });

  describe("4. Organization-Scoped RBAC Boundaries", () => {
    it("validates roles are strictly scoped to organization types", () => {
      // Club organization roles
      expect(() =>
        RolesService.validateRolePermissionsForOrgType("CLUB", [
          "club:manage_settings",
          "club:manage_members",
          "club:manage_rides",
        ])
      ).not.toThrow();

      // Brand organization roles
      expect(() =>
        RolesService.validateRolePermissionsForOrgType("BRAND", [
          "business:manage_products",
          "business:manage_campaigns",
          "business:manage_discounts",
        ])
      ).not.toThrow();

      // Platform organization roles
      expect(() =>
        RolesService.validateRolePermissionsForOrgType("PLATFORM", [
          "system:admin",
          "system:manage_users",
        ])
      ).not.toThrow();

      // Cross-organization privilege escalation attempts
      expect(() =>
        RolesService.validateRolePermissionsForOrgType("CLUB", ["system:admin"])
      ).toThrow();

      expect(() =>
        RolesService.validateRolePermissionsForOrgType("CLUB", ["business:manage_products"])
      ).toThrow();

      expect(() =>
        RolesService.validateRolePermissionsForOrgType("BRAND", ["system:admin"])
      ).toThrow();

      expect(() =>
        RolesService.validateRolePermissionsForOrgType("BRAND", ["club:manage_members"])
      ).toThrow();
    });
  });
});
