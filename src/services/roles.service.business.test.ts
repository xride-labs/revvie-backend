import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import { RolesService } from "./roles.service.js";
import { createTestUser, cleanupTestData } from "../test/utils.js";

describe("business permission seeds", () => {
  it("registers manage_settings/members/roles codes with BUSINESS scope", async () => {
    const codes = ["business:manage_settings", "business:manage_members", "business:manage_roles"];
    const rows = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(rows.map((r) => r.code).sort()).toEqual([...codes].sort());
    expect(new Set(rows.map((r) => r.scope))).toEqual(new Set(["BUSINESS"]));
  });

  it("seeds tiered system BUSINESS roles with descending permission counts", async () => {
    const roles = await prisma.role.findMany({
      where: { scope: "BUSINESS", scopeId: null, isSystem: true },
      include: { permissions: true },
      orderBy: { priority: "desc" },
    });
    const bySlug = Object.fromEntries(roles.map((r) => [r.slug, r.permissions.length]));
    expect(bySlug.owner).toBeGreaterThan(0);
    expect(bySlug.owner).toBeGreaterThanOrEqual(bySlug.admin);
    expect(bySlug.admin).toBeGreaterThanOrEqual(bySlug.moderator);
    expect(bySlug.moderator).toBeGreaterThanOrEqual(bySlug.member);
  });

  it("backfill maps all four enum values to BUSINESS role rows", async () => {
    const { mapEnumToSlug } = await import("../scripts/backfill-brand-member-roles.js");
    expect(mapEnumToSlug("OWNER")).toBe("owner");
    expect(mapEnumToSlug("ADMIN")).toBe("admin");
    expect(mapEnumToSlug("MODERATOR")).toBe("moderator");
    expect(mapEnumToSlug("MEMBER")).toBe("member");
    expect(() => mapEnumToSlug("GHOST" as never)).toThrow();
  });
});

// ─── Task 2: getBusinessPermissions resolver + role CRUD ─────────────────────

let bizSlugSeq = 0;
function uniqueBizSlug() {
  return `biz-${Date.now().toString(36)}-${bizSlugSeq++}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/** Create a BusinessProfile row directly with the real required fields. */
async function createBusiness(ownerId: string) {
  return prisma.businessProfile.create({
    data: {
      ownerId,
      categories: ["BRAND"],
      displayName: "Acme Motors",
      slug: uniqueBizSlug(),
      verification: "PENDING",
    },
  });
}

/** Resolve a BUSINESS system role id (scope BUSINESS, scopeId null). */
async function businessRoleId(slug: string): Promise<string> {
  const role = await prisma.role.findFirstOrThrow({
    where: { slug: slug.toLowerCase(), scope: "BUSINESS", scopeId: null },
    select: { id: true },
  });
  return role.id;
}

/** Resolve the exact permission code set of a BUSINESS system role. */
async function businessRoleCodes(slug: string): Promise<string[]> {
  const role = await prisma.role.findFirstOrThrow({
    where: { slug: slug.toLowerCase(), scope: "BUSINESS", scopeId: null },
    include: { permissions: { include: { permission: true } } },
  });
  return role.permissions.map((rp) => rp.permission.code);
}

/** Grant GLOBAL super_admin (platform admin bypass) to a user. */
async function grantSuperAdmin(userId: string) {
  let role = await prisma.role.findFirst({
    where: { slug: "super_admin", scope: "GLOBAL" },
    select: { id: true },
  });
  if (!role) {
    role = await prisma.role.create({
      data: { name: "Super Admin", slug: "super_admin", scope: "GLOBAL", isSystem: true },
      select: { id: true },
    });
  }
  await prisma.userRoleAssignment.create({
    data: { userId, roleId: role.id },
  });
}

describe("getBusinessPermissions resolver", () => {
  afterEach(async () => {
    // FK children before parents, then users via cleanupTestData().
    await prisma.brandMember.deleteMany({});
    await prisma.businessProfile.deleteMany({});
    await cleanupTestData();
  });

  it("owner bypass grants full permissions without a membership row", async () => {
    const { user } = await createTestUser();
    const biz = await createBusiness(user.id);

    const { permissions, role } = await RolesService.getBusinessPermissions(user.id, biz.id);

    expect(permissions).toContain("business:manage_roles");
    expect(permissions).toContain("business:manage");
    expect(role?.slug).toBe("owner");
    // No membership row exists — access comes from the owner bypass alone.
    const membership = await prisma.brandMember.findUnique({
      where: { businessId_userId: { businessId: biz.id, userId: user.id } },
    });
    expect(membership).toBeNull();
  });

  it("platform admin bypass grants all BUSINESS codes", async () => {
    const { user: owner } = await createTestUser();
    const biz = await createBusiness(owner.id);
    const { user: admin } = await createTestUser();
    await grantSuperAdmin(admin.id);

    const { permissions } = await RolesService.getBusinessPermissions(admin.id, biz.id);

    expect(permissions).toContain("business:manage");
    expect(permissions).toContain("business:manage_roles");
  });

  it("member-role permissions resolve through the role join", async () => {
    const { user: owner } = await createTestUser();
    const biz = await createBusiness(owner.id);
    const { user: member } = await createTestUser();
    await prisma.brandMember.create({
      data: { businessId: biz.id, userId: member.id, roleId: await businessRoleId("member") },
    });

    const { permissions, role } = await RolesService.getBusinessPermissions(member.id, biz.id);

    expect(role?.slug).toBe("member");
    expect([...permissions].sort()).toEqual((await businessRoleCodes("member")).sort());
  });

  it("deleted custom role falls back to member", async () => {
    const { user: owner } = await createTestUser();
    const biz = await createBusiness(owner.id);
    const { user: member } = await createTestUser();
    await prisma.brandMember.create({
      data: { businessId: biz.id, userId: member.id, roleId: await businessRoleId("member") },
    });
    const custom = await RolesService.createBusinessRole(biz.id, {
      name: "Deals Only",
      permissionCodes: ["business:manage_deals"],
    });
    await RolesService.assignBusinessMemberRole(biz.id, member.id, custom.id);

    await RolesService.deleteBusinessRole(biz.id, custom.id);

    const { permissions, role } = await RolesService.getBusinessPermissions(member.id, biz.id);
    expect(role?.slug).toBe("member");
    expect([...permissions].sort()).toEqual((await businessRoleCodes("member")).sort());
  });
});
