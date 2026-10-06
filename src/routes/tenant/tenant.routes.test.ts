import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import tenantRoutes from "./tenant.routes.js";
import { TenantService } from "../../services/tenant.service.js";
import { RolesService } from "../../services/roles.service.js";

const app = express();
app.use(express.json());
app.use("/api/tenant", tenantRoutes);

describe("Tenant Routes & Roles Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/tenant/resolve", () => {
    it("resolves tenant from hostname query param", async () => {
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

      const res = await request(app).get("/api/tenant/resolve?hostname=ktm-bangalore.revvie.app");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.found).toBe(true);
      expect(res.body.data.tenant.slug).toBe("ktm-bangalore");
      expect(res.body.data.tenant.type).toBe("CLUB");
    });

    it("resolves tenant from slug query param", async () => {
      vi.spyOn(TenantService, "resolveBySlug").mockResolvedValueOnce({
        found: true,
        tenant: {
          type: "BRAND",
          organizationId: "org-456",
          slug: "ktm",
          name: "KTM Official",
          status: "ACTIVE",
          isPlatform: false,
          isConsumer: false,
          businessId: "biz-456",
        },
      });

      const res = await request(app).get("/api/tenant/resolve?slug=ktm");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.found).toBe(true);
      expect(res.body.data.tenant.slug).toBe("ktm");
      expect(res.body.data.tenant.type).toBe("BRAND");
    });
  });

  describe("RolesService.validateRolePermissionsForOrgType", () => {
    it("allows club permissions for CLUB organization", () => {
      expect(() => {
        RolesService.validateRolePermissionsForOrgType("CLUB", [
          "club:manage_settings",
          "club:manage_rides",
        ]);
      }).not.toThrow();
    });

    it("throws when system or business permission assigned to CLUB organization", () => {
      expect(() => {
        RolesService.validateRolePermissionsForOrgType("CLUB", [
          "club:manage_settings",
          "system:admin",
        ]);
      }).toThrow(/not permitted for organization type CLUB/i);

      expect(() => {
        RolesService.validateRolePermissionsForOrgType("CLUB", [
          "business:manage_products",
        ]);
      }).toThrow(/not permitted for organization type CLUB/i);
    });

    it("allows business permissions for BRAND organization", () => {
      expect(() => {
        RolesService.validateRolePermissionsForOrgType("BRAND", [
          "business:manage_products",
          "business:manage_campaigns",
        ]);
      }).not.toThrow();
    });

    it("throws when system permission assigned to BRAND organization", () => {
      expect(() => {
        RolesService.validateRolePermissionsForOrgType("BRAND", [
          "system:manage_users",
        ]);
      }).toThrow(/not permitted for organization type BRAND/i);
    });
  });
});
