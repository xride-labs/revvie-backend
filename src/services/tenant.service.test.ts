import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TenantService,
  normalizeHost,
  extractSubdomain,
  isReservedSubdomain,
} from "./tenant.service.js";
import prisma from "../lib/prisma.js";

describe("TenantService and Subdomain Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("normalizeHost", () => {
    it("lowercases host and strips ports and www prefixes", () => {
      expect(normalizeHost("KTM-Bangalore.Revvie.App:3000")).toBe("ktm-bangalore.revvie.app");
      expect(normalizeHost("www.revvie.app")).toBe("revvie.app");
      expect(normalizeHost("WWW.KTM.REvvie.xride-labs.in:5000")).toBe("ktm.revvie.xride-labs.in");
    });
  });

  describe("extractSubdomain", () => {
    it("extracts subdomain correctly relative to root domain", () => {
      expect(extractSubdomain("revvie.app", "revvie.app")).toBeNull();
      expect(extractSubdomain("admin.revvie.app", "revvie.app")).toBe("admin");
      expect(extractSubdomain("ktm-bangalore.revvie.app", "revvie.app")).toBe("ktm-bangalore");
      expect(extractSubdomain("ktm-bangalore.revvie.xride-labs.in", "revvie.xride-labs.in")).toBe("ktm-bangalore");
      expect(extractSubdomain("admin.revvie.xride-labs.in", "revvie.xride-labs.in")).toBe("admin");
      expect(extractSubdomain("revvie.xride-labs.in", "revvie.xride-labs.in")).toBeNull();
      expect(extractSubdomain("localhost", "localhost")).toBeNull();
      expect(extractSubdomain("ktm.localhost", "localhost")).toBe("ktm");
    });
  });

  describe("isReservedSubdomain", () => {
    it("identifies reserved subdomains", () => {
      expect(isReservedSubdomain("admin")).toBe(true);
      expect(isReservedSubdomain("api")).toBe(true);
      expect(isReservedSubdomain("www")).toBe(true);
      expect(isReservedSubdomain("auth")).toBe(true);
      expect(isReservedSubdomain("ktm")).toBe(false);
      expect(isReservedSubdomain("ktm-bangalore")).toBe(false);
    });
  });

  describe("TenantService.resolveFromHost", () => {
    it("returns CONSUMER context when host matches root domain", async () => {
      const result = await TenantService.resolveFromHost("revvie.app", "revvie.app");
      expect(result.found).toBe(true);
      expect(result.tenant.type).toBe("CONSUMER");
      expect(result.tenant.isConsumer).toBe(true);
      expect(result.tenant.isPlatform).toBe(false);
    });

    it("returns PLATFORM context when host is admin subdomain", async () => {
      vi.spyOn(prisma.organization, "findUnique").mockResolvedValueOnce({
        id: "platform-org-id",
        name: "Revvie Platform",
        slug: "admin",
        type: "PLATFORM",
        status: "ACTIVE",
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await TenantService.resolveFromHost("admin.revvie.app", "revvie.app");
      expect(result.found).toBe(true);
      expect(result.tenant.type).toBe("PLATFORM");
      expect(result.tenant.isPlatform).toBe(true);
      expect(result.tenant.slug).toBe("admin");
    });

    it("resolves club tenant from domain mapping", async () => {
      vi.spyOn(prisma.organizationDomain, "findUnique").mockResolvedValueOnce({
        id: "domain-1",
        organizationId: "club-org-1",
        hostname: "ktm-bangalore.revvie.app",
        isPrimary: true,
        isCustom: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        organization: {
          id: "club-org-1",
          name: "KTM Bangalore Riders",
          slug: "ktm-bangalore",
          type: "CLUB",
          status: "ACTIVE",
          club: {
            id: "club-entity-1",
          },
          businessProfile: null,
        },
      } as any);

      const result = await TenantService.resolveFromHost("ktm-bangalore.revvie.app", "revvie.app");
      expect(result.found).toBe(true);
      expect(result.tenant.type).toBe("CLUB");
      expect(result.tenant.organizationId).toBe("club-org-1");
      expect(result.tenant.clubId).toBe("club-entity-1");
      expect(result.tenant.name).toBe("KTM Bangalore Riders");
    });

    it("returns found: false when domain does not exist in DB", async () => {
      vi.spyOn(prisma.organizationDomain, "findUnique").mockResolvedValueOnce(null);
      vi.spyOn(prisma.organization, "findUnique").mockResolvedValueOnce(null);

      const result = await TenantService.resolveFromHost("unknown-club.revvie.app", "revvie.app");
      expect(result.found).toBe(false);
    });
  });
});
