import { describe, it, expect } from "vitest";
import prisma from "../lib/prisma.js";
import { slugify } from "../scripts/backfill-organizations.js";

describe("Organization Schema & Models", () => {
  it("exposes organization, organizationDomain, and organizationMembership on prisma client", () => {
    // Assert prisma client has the delegate methods
    expect((prisma as any).organization).toBeDefined();
    expect((prisma as any).organizationDomain).toBeDefined();
    expect((prisma as any).organizationMembership).toBeDefined();
    expect(typeof (prisma as any).organization?.findMany).toBe("function");
    expect(typeof (prisma as any).organizationDomain?.findMany).toBe("function");
    expect(typeof (prisma as any).organizationMembership?.findMany).toBe("function");
  });

  it("slugify generates clean URL-safe slugs", () => {
    expect(slugify("KTM Bangalore Riders")).toBe("ktm-bangalore-riders");
    expect(slugify("R & D Motor Club!")).toBe("r-and-d-motor-club");
    expect(slugify("  Special---Club--  ")).toBe("special-club");
  });
});

