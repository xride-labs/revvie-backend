/**
 * Multi-role permission utilities for Revvie platform.
 *
 * Users can hold multiple roles simultaneously (e.g. CLUB_OWNER + SELLER).
 */

// Mirror the Prisma enum – kept in sync manually to avoid importing generated client everywhere.
/**
 * @deprecated Legacy static role shim. Use permission codes via
 * `RolesService.hasPermission(userId, code)` with `requirePermission(...)` /
 * `requireBusinessPermission(...)` middleware instead of role-enum checks.
 */
export enum UserRole {
  ADMIN = "ADMIN",
  CO_ADMIN = "CO_ADMIN",
  MODERATOR = "MODERATOR",
  CLUB_OWNER = "CLUB_OWNER",
  CLUB_ADMIN = "CLUB_ADMIN",
  CLUB_MODERATOR = "CLUB_MODERATOR",
  BRAND_OWNER = "BRAND_OWNER",
  BRAND_ADMIN = "BRAND_ADMIN",
  BRAND_MODERATOR = "BRAND_MODERATOR",
  RIDER = "RIDER",
  SELLER = "SELLER",
}

// ─── Platform access lists ───────────────────────────────────────────

/** Roles that may access the **web** admin / manager portal */
export const WEB_ACCESS_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.CO_ADMIN,
  UserRole.MODERATOR,
  UserRole.CLUB_OWNER,
  UserRole.CLUB_ADMIN,
  UserRole.CLUB_MODERATOR,
  UserRole.BRAND_OWNER,
  UserRole.BRAND_ADMIN,
  UserRole.BRAND_MODERATOR,
  UserRole.SELLER,
];

/** Roles designed for the **mobile** app */
export const MOBILE_ACCESS_ROLES: UserRole[] = [
  UserRole.RIDER,
  UserRole.CLUB_OWNER,
  UserRole.CLUB_ADMIN,
  UserRole.CLUB_MODERATOR,
  UserRole.BRAND_OWNER,
  UserRole.BRAND_ADMIN,
  UserRole.BRAND_MODERATOR,
  UserRole.SELLER,
  UserRole.MODERATOR,
  UserRole.CO_ADMIN,
  UserRole.ADMIN,
];

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Check whether the user holds **any** of the required roles.
 *
 * @deprecated Legacy role-list check. Use `RolesService.hasPermission(userId, code)`
 * with `requirePermission(...)` / `requireBusinessPermission(...)` instead.
 */
export function hasAnyRole(
  userRoles: UserRole[],
  requiredRoles: UserRole[],
): boolean {
  return requiredRoles.some((r) => userRoles.includes(r));
}

/** Check whether the user holds **all** of the required roles. */
export function hasAllRoles(
  userRoles: UserRole[],
  requiredRoles: UserRole[],
): boolean {
  return requiredRoles.every((r) => userRoles.includes(r));
}

/** Check if user is any kind of admin */
export function isAdmin(userRoles: UserRole[]): boolean {
  return hasAnyRole(userRoles, [UserRole.ADMIN, UserRole.CO_ADMIN]);
}

/** Check if user is a super admin. */
export function isSuperAdmin(userRoles: UserRole[]): boolean {
  return userRoles.includes(UserRole.ADMIN);
}

/**
 * Platform staff override. Accepts the loosely-typed `roles` string array that
 * `requireAuth` attaches to `req.session.user`. ADMIN and CO_ADMIN can manage
 * any resource regardless of ownership ("admins can change anything").
 *
 * @deprecated Legacy staff check. Use `RolesService.hasPermission(userId, code)`
 * with `requirePermission(...)` / `requireBusinessPermission(...)` instead.
 */
export function isStaff(roles: readonly string[] | null | undefined): boolean {
  if (!roles) return false;
  return roles.includes(UserRole.ADMIN) || roles.includes(UserRole.CO_ADMIN);
}

/** Can the user access the web portal? */
export function canAccessWeb(userRoles: UserRole[]): boolean {
  return hasAnyRole(userRoles, WEB_ACCESS_ROLES);
}

/** Can the user access the mobile app? */
export function canAccessMobile(userRoles: UserRole[]): boolean {
  // Admins and rider roles can access mobile.
  return hasAnyRole(userRoles, MOBILE_ACCESS_ROLES);
}

/** Normalise a roles array – deduplicates. */
export function normalizeRoles(roles: UserRole[]): UserRole[] {
  const set = new Set(roles);
  return Array.from(set);
}

/**
 * Role permission matrix.
 * Maps each conceptual permission to the roles that grant it.
 *
 * @deprecated Legacy static permission matrix. Use permission codes via
 * `RolesService.hasPermission(userId, code)` with `requirePermission(...)` /
 * `requireBusinessPermission(...)` middleware instead.
 */
export const PERMISSIONS = {
  // Admin
  VIEW_ADMIN_DASHBOARD: [UserRole.ADMIN, UserRole.CO_ADMIN, UserRole.MODERATOR],
  MANAGE_USERS: [UserRole.ADMIN, UserRole.CO_ADMIN],
  MANAGE_ADMINS: [UserRole.ADMIN],
  VIEW_METRICS: [UserRole.ADMIN],
  MODERATE_CONTENT: [UserRole.ADMIN, UserRole.CO_ADMIN, UserRole.MODERATOR],
  VERIFY_CLUBS: [UserRole.ADMIN, UserRole.CO_ADMIN],

  // Club owner
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

  // Seller
  MANAGE_LISTINGS: [UserRole.ADMIN, UserRole.CO_ADMIN, UserRole.SELLER],

  // Rider / User (mobile)
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
} as const;

export type Permission = keyof typeof PERMISSIONS;

/** Check whether a user has a specific permission. */
export function hasPermission(
  userRoles: UserRole[],
  permission: Permission,
): boolean {
  return hasAnyRole(userRoles, [...PERMISSIONS[permission]]);
}
