/**
 * Full permission-matrix tests for src/lib/utils/permissions.ts.
 *
 * The grid below is the explicit product spec: every (role, permission) pair
 * is asserted literally, so an accidental edit to the PERMISSIONS lists
 * fails loudly instead of silently widening or narrowing access.
 */

import {
  UserRole,
  WEB_ACCESS_ROLES,
  MOBILE_ACCESS_ROLES,
  PERMISSIONS,
  hasAnyRole,
  hasAllRoles,
  hasPermission,
  isAdmin,
  isSuperAdmin,
  isStaff,
  canAccessWeb,
  canAccessMobile,
  normalizeRoles,
  type Permission,
} from "./permissions.js";

const ALL_ROLES = Object.values(UserRole);

// ─── Role catalogue ──────────────────────────────────────────────────────

describe("UserRole catalogue", () => {
  it("defines exactly the 11 platform roles", () => {
    expect(ALL_ROLES).toEqual([
      "ADMIN",
      "CO_ADMIN",
      "MODERATOR",
      "CLUB_OWNER",
      "CLUB_ADMIN",
      "CLUB_MODERATOR",
      "BRAND_OWNER",
      "BRAND_ADMIN",
      "BRAND_MODERATOR",
      "RIDER",
      "SELLER",
    ]);
  });

  it.each(ALL_ROLES)("%s appears in both access lists or has a reason", (role) => {
    // Every role must be able to reach at least one platform surface.
    expect(
      WEB_ACCESS_ROLES.includes(role) || MOBILE_ACCESS_ROLES.includes(role),
    ).toBe(true);
  });
});

describe("platform access lists", () => {
  it("grants web portal access to exactly these roles", () => {
    expect(canAccessWeb([UserRole.ADMIN])).toBe(true);
    expect(canAccessWeb([UserRole.CO_ADMIN])).toBe(true);
    expect(canAccessWeb([UserRole.MODERATOR])).toBe(true);
    expect(canAccessWeb([UserRole.CLUB_OWNER])).toBe(true);
    expect(canAccessWeb([UserRole.SELLER])).toBe(true);
  });

  it("denies web portal access to plain riders", () => {
    expect(canAccessWeb([UserRole.RIDER])).toBe(false);
  });

  it("grants mobile access to every role", () => {
    for (const role of ALL_ROLES) {
      expect(canAccessMobile([role])).toBe(true);
    }
  });

  it("keeps every listed role a valid UserRole", () => {
    for (const role of [...WEB_ACCESS_ROLES, ...MOBILE_ACCESS_ROLES]) {
      expect(ALL_ROLES).toContain(role);
    }
  });
});

// ─── Permission matrix (explicit spec) ──────────────────────────────────

const EXPECTED_MATRIX: Record<Permission, UserRole[]> = {
  VIEW_ADMIN_DASHBOARD: [UserRole.ADMIN, UserRole.CO_ADMIN, UserRole.MODERATOR],
  MANAGE_USERS: [UserRole.ADMIN, UserRole.CO_ADMIN],
  MANAGE_ADMINS: [UserRole.ADMIN],
  VIEW_METRICS: [UserRole.ADMIN],
  MODERATE_CONTENT: [UserRole.ADMIN, UserRole.CO_ADMIN, UserRole.MODERATOR],
  VERIFY_CLUBS: [UserRole.ADMIN, UserRole.CO_ADMIN],
  MANAGE_OWN_CLUBS: [
    UserRole.ADMIN,
    UserRole.CO_ADMIN,
    UserRole.CLUB_OWNER,
    UserRole.CLUB_ADMIN,
    UserRole.CLUB_MODERATOR,
  ],
  MANAGE_CLUB_RIDES: [
    UserRole.ADMIN,
    UserRole.CO_ADMIN,
    UserRole.CLUB_OWNER,
    UserRole.CLUB_ADMIN,
    UserRole.CLUB_MODERATOR,
  ],
  MANAGE_CLUB_MEMBERS: [
    UserRole.ADMIN,
    UserRole.CO_ADMIN,
    UserRole.CLUB_OWNER,
    UserRole.CLUB_ADMIN,
    UserRole.CLUB_MODERATOR,
  ],
  MANAGE_LISTINGS: [UserRole.ADMIN, UserRole.CO_ADMIN, UserRole.SELLER],
  JOIN_RIDES: [
    UserRole.RIDER,
    UserRole.CLUB_OWNER,
    UserRole.CLUB_ADMIN,
    UserRole.CLUB_MODERATOR,
    UserRole.BRAND_OWNER,
    UserRole.BRAND_ADMIN,
    UserRole.BRAND_MODERATOR,
    UserRole.SELLER,
  ],
  CREATE_RIDES: [
    UserRole.RIDER,
    UserRole.CLUB_OWNER,
    UserRole.CLUB_ADMIN,
    UserRole.CLUB_MODERATOR,
    UserRole.BRAND_OWNER,
    UserRole.BRAND_ADMIN,
    UserRole.BRAND_MODERATOR,
    UserRole.SELLER,
    UserRole.CO_ADMIN,
    UserRole.ADMIN,
  ],
  JOIN_CLUBS: [
    UserRole.RIDER,
    UserRole.CLUB_OWNER,
    UserRole.CLUB_ADMIN,
    UserRole.CLUB_MODERATOR,
    UserRole.BRAND_OWNER,
    UserRole.BRAND_ADMIN,
    UserRole.BRAND_MODERATOR,
    UserRole.SELLER,
  ],
  CREATE_CLUBS: [
    UserRole.RIDER,
    UserRole.CLUB_OWNER,
    UserRole.CLUB_ADMIN,
    UserRole.CLUB_MODERATOR,
    UserRole.BRAND_OWNER,
    UserRole.BRAND_ADMIN,
    UserRole.BRAND_MODERATOR,
    UserRole.SELLER,
    UserRole.CO_ADMIN,
    UserRole.ADMIN,
  ],
  CREATE_LISTINGS: [
    UserRole.RIDER,
    UserRole.CLUB_OWNER,
    UserRole.CLUB_ADMIN,
    UserRole.CLUB_MODERATOR,
    UserRole.BRAND_OWNER,
    UserRole.BRAND_ADMIN,
    UserRole.BRAND_MODERATOR,
    UserRole.SELLER,
    UserRole.CO_ADMIN,
    UserRole.ADMIN,
  ],
};

const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

describe("PERMISSIONS registry integrity", () => {
  it("exposes the documented permission set", () => {
    expect(PERMISSION_KEYS.sort()).toEqual(
      Object.keys(EXPECTED_MATRIX).sort(),
    );
  });

  it.each(PERMISSION_KEYS)("lists only valid roles for %s", (perm) => {
    for (const role of PERMISSIONS[perm]) {
      expect(ALL_ROLES).toContain(role);
    }
  });

  it.each(PERMISSION_KEYS)("never leaves %s empty", (perm) => {
    expect(PERMISSIONS[perm].length).toBeGreaterThan(0);
  });
});

describe("hasPermission — full role × permission grid", () => {
  const cases: Array<[Permission, UserRole, boolean]> = [];
  for (const perm of PERMISSION_KEYS) {
    for (const role of ALL_ROLES) {
      cases.push([perm, role, EXPECTED_MATRIX[perm].includes(role)]);
    }
  }

  it.each(cases)("%s × %s → %s", (perm, role, expected) => {
    expect(hasPermission([role], perm)).toBe(expected);
  });

  it("matches the declared lists for multi-role users", () => {
    for (const perm of PERMISSION_KEYS) {
      expect(hasPermission([...ALL_ROLES], perm)).toBe(true);
      expect(hasPermission([], perm)).toBe(false);
    }
  });

  it("JOIN_* permissions currently exclude ADMIN/CO_ADMIN (known gap)", () => {
    // Documenting current behaviour explicitly so that if this changes the
    // diff is deliberate. Admins can create rides/clubs but cannot join them
    // through the permission gate today.
    expect(hasPermission([UserRole.ADMIN], "JOIN_RIDES")).toBe(false);
    expect(hasPermission([UserRole.CO_ADMIN], "JOIN_CLUBS")).toBe(false);
  });
});

// ─── Helper logic ────────────────────────────────────────────────────────

describe("hasAnyRole", () => {
  it.each([
    [[UserRole.RIDER], [UserRole.RIDER], true],
    [[UserRole.RIDER], [UserRole.ADMIN], false],
    [[UserRole.RIDER, UserRole.SELLER], [UserRole.SELLER], true],
    [[], [UserRole.RIDER], false],
    [[UserRole.RIDER], [], false],
    [[], [], false],
  ])("%j vs %j → %s", (user, required, expected) => {
    expect(hasAnyRole(user as UserRole[], required as UserRole[])).toBe(
      expected,
    );
  });
});

describe("hasAllRoles", () => {
  it.each([
    [
      [UserRole.ADMIN, UserRole.SELLER],
      [UserRole.ADMIN, UserRole.SELLER],
      true,
    ],
    [[UserRole.ADMIN], [UserRole.ADMIN, UserRole.SELLER], false],
    [[], [], true], // vacuous truth — every() on empty array
    [[UserRole.RIDER], [], true],
  ])("%j vs %j → %s", (user, required, expected) => {
    expect(hasAllRoles(user as UserRole[], required as UserRole[])).toBe(
      expected,
    );
  });
});

describe("isAdmin / isSuperAdmin", () => {
  it.each([
    [[UserRole.ADMIN], true],
    [[UserRole.CO_ADMIN], true],
    [[UserRole.MODERATOR], false],
    [[UserRole.RIDER], false],
    [[], false],
  ])("isAdmin(%j) → %s", (roles, expected) => {
    expect(isAdmin(roles as UserRole[])).toBe(expected);
  });

  it.each([
    [[UserRole.ADMIN], true],
    [[UserRole.CO_ADMIN], false],
    [[UserRole.ADMIN, UserRole.RIDER], true],
    [[], false],
  ])("isSuperAdmin(%j) → %s", (roles, expected) => {
    expect(isSuperAdmin(roles as UserRole[])).toBe(expected);
  });

  it("CO_ADMIN is admin but not super admin", () => {
    expect(isAdmin([UserRole.CO_ADMIN])).toBe(true);
    expect(isSuperAdmin([UserRole.CO_ADMIN])).toBe(false);
  });
});

describe("isStaff", () => {
  it.each([
    [["ADMIN"], true],
    [["CO_ADMIN"], true],
    [["ADMIN", "RIDER"], true],
    [["RIDER"], false],
    [[], false],
    [null, false],
    [undefined, false],
  ])("isStaff(%j) → %s", (roles, expected) => {
    expect(isStaff(roles as string[] | null | undefined)).toBe(expected);
  });

  it("is case-sensitive ('admin' is not staff)", () => {
    expect(isStaff(["admin"])).toBe(false);
  });
});

describe("normalizeRoles", () => {
  it("deduplicates while preserving first-seen order", () => {
    expect(
      normalizeRoles([UserRole.RIDER, UserRole.ADMIN, UserRole.RIDER]),
    ).toEqual([UserRole.RIDER, UserRole.ADMIN]);
  });

  it.each([[[]], [[UserRole.RIDER]], [[UserRole.RIDER, UserRole.RIDER, UserRole.RIDER]]])(
    "normalizes %j to unique roles",
    (roles) => {
      const out = normalizeRoles(roles as UserRole[]);
      expect(new Set(out).size).toBe(out.length);
    },
  );
});
