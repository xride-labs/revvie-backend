import jwt from "jsonwebtoken";
import prisma from "../../lib/prisma.js";

/**
 * Test double for Better Auth.
 *
 * The real `auth.api.getSession()` validates Better Auth session cookies/bearer
 * tokens against its own tables. In tests we never run the real auth handler
 * (toNodeHandler is mocked too), so instead we bridge the JWT that
 * `createTestUser` / `createMockToken` issues: decode it, load the user from
 * Postgres, and return a session shaped exactly like Better Auth's.
 *
 * This lets the real `requireAuth` / `optionalAuth` middleware run unmodified
 * while tests authenticate with a simple `Authorization: Bearer <jwt>` header.
 */

type AnyHeaders =
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null }
  | undefined;

function readAuthHeader(headers: AnyHeaders): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as any).get === "function") {
    return (headers as any).get("authorization") ?? undefined;
  }
  const value =
    (headers as Record<string, string | string[] | undefined>).authorization ??
    (headers as Record<string, string | string[] | undefined>).Authorization;
  return Array.isArray(value) ? value[0] : value;
}

export function betterAuth(options: Record<string, unknown> = {}) {
  return {
    options,
    api: {
      getSession: async ({ headers }: { headers?: AnyHeaders } = {}) => {
        const authHeader = readAuthHeader(headers);
        if (!authHeader) return null;

        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (!token) return null;

        let payload: { userId?: string };
        try {
          payload = jwt.verify(
            token,
            process.env.JWT_SECRET || "test-secret",
          ) as { userId?: string };
        } catch {
          return null;
        }

        if (!payload?.userId) return null;

        const user = await prisma.user
          .findUnique({ where: { id: payload.userId } })
          .catch(() => null);
        if (!user) return null;

        const u = user as Record<string, any>;
        return {
          user: {
            id: u.id,
            email: u.email ?? null,
            name: u.name ?? null,
            image: u.avatar ?? u.image ?? null,
            avatar: u.avatar ?? null,
            phone: u.phone ?? null,
            emailVerified: u.emailVerified ?? true,
          },
          session: {
            id: `test-session-${u.id}`,
            token,
            userId: u.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        };
      },

      // Routes that delegate to Better Auth's own APIs (which we don't run in
      // tests). Resolve them optimistically so the surrounding route logic can
      // be exercised; the real password/email logic is Better Auth's concern.
      changePassword: async () => ({ status: true }),
      setPassword: async () => ({ status: true }),
      signOut: async () => ({ success: true }),
    },
  };
}
