import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, emailOTP, magicLink } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import prisma from "../lib/prisma.js";
import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import {
  sendOtpEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendMagicLinkEmail,
} from "../lib/mailer.js";

// User roles enum (sync with Prisma schema)
export enum UserRole {
  ADMIN = "ADMIN",
  CO_ADMIN = "CO_ADMIN",
  CLUB_OWNER = "CLUB_OWNER",
  RIDER = "RIDER",
  SELLER = "SELLER",
}

// Session interface (attached to request)
export interface AuthSession {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    image: string | null;
    phone: string | null;
    roles: string[];
  };
  session: {
    id: string;
    token: string;
    expiresAt: Date;
  };
}

// Extend Express Request type
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: AuthSession;
    }
  }
}

/**
 * Better Auth configuration
 */
export const auth = betterAuth({
  logger: {
    level: process.env.NODE_ENV === "production" ? "warn" : "debug",
  },

  // Secret for signing tokens/cookies
  secret: process.env.BETTER_AUTH_SECRET,

  // Base URL for callbacks and redirects
  baseURL:
    process.env.BETTER_AUTH_BASE_URL ||
    process.env.AUTH_URL ||
    "http://localhost:5000",
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  // Base path for auth endpoints
  basePath: "/api/auth",

  // Trust host for production
  trustedOrigins: [
    process.env.FRONTEND_URL || "http://localhost:3000",
    process.env.MOBILE_APP_URL || "http://localhost:8081",
    "http://localhost:*",
    "http://127.0.0.1:*",
    "http://10.0.2.2:*",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://10.0.2.2:8081",
    "http://10.0.2.2:5000",
    "http://10.0.2.2:3000",
    "exp://*",
    "exp://10.0.2.2:8081",
    "exp://localhost:8081",
    "exp://127.0.0.1:8081",
    "revvie://*",
    "http://10.0.2.2:19000",
    "http://localhost:19000",
    "http://10.0.2.2:19006",
    "http://localhost:19006",
    "https://*.xride-labs.in",
    "https://revvie.xride-labs.in",
    "https://api.revvie.xride-labs.in",
  ],

  // Enable email and password authentication
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification:
      process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === "true" ||
      process.env.NODE_ENV === "production",
    sendResetPassword: async ({ user, url }) => {
      if (!user.email) {
        return;
      }

      if (process.env.NODE_ENV === "development") {
        console.log(`\n==================================`);
        console.log(`[DEV] Password Reset Link for ${user.email} → ${url}`);
        console.log(`==================================\n`);
      }

      try {
        const sent = await sendResetPasswordEmail({
          to: user.email,
          name: user.name,
          resetUrl: url,
        });

        if (!sent) {
          console.warn(`[AUTH] Failed to send reset password email to ${user.email}`);
        }
      } catch (error) {
        console.error(`[AUTH] sendResetPassword error for ${user.email}:`, error);
      }
    },
  },

  // Email verification configuration
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      if (!user.email) {
        return;
      }

      const sent = await sendVerificationEmail({
        to: user.email,
        name: user.name,
        verifyUrl: url,
      });

      if (!sent) {
        throw new Error("Failed to send verification email");
      }
    },
    sendOnSignUp: true,
  },

  // Database hooks for custom logic on user creation
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Auto-assign RIDER role on signup
          try {
            await prisma.userRoleAssignment.create({
              data: { userId: user.id, role: "RIDER" },
            });
            console.log(`[AUTH] RIDER role assigned to ${user.id}`);
          } catch (error) {
            console.warn(`[AUTH] Failed to assign RIDER role:`, error);
          }

          // Keep legacy avatar in sync when OAuth providers populate image.
          try {
            const oauthImage = (user as any).image as string | undefined;
            const currentAvatar = (user as any).avatar as string | undefined;
            if (oauthImage && !currentAvatar) {
              await prisma.user.update({
                where: { id: user.id },
                data: { avatar: oauthImage },
              });
            }
          } catch (error) {
            console.warn(`[AUTH] Failed to sync avatar from image:`, error);
          }

          if (user.email) {
            try {
              const sent = await sendWelcomeEmail({
                to: user.email,
                name: user.name,
              });
              if (!sent) {
                console.warn(
                  `[AUTH] Failed to send welcome email for ${user.email}`,
                );
              }
            } catch (error) {
              console.warn(
                `[AUTH] Welcome email threw for ${user.email}:`,
                error,
              );
            }
          }
        },
      },
    },
  },

  // Social providers
  socialProviders: {
    google: {
      clientId: process.env.AUTH_GOOGLE_ID || "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET || "",
    },
  },

  // Session configuration
  session: {
    expiresIn: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // Update session every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },

  // Share auth cookies across subdomains in production.
  advanced: {
    crossSubDomainCookies: {
      enabled: process.env.NODE_ENV === "production" && !!process.env.BETTER_AUTH_COOKIE_DOMAIN,
      domain: process.env.BETTER_AUTH_COOKIE_DOMAIN || ".xride-labs.in",
    },
  },

  // Custom user fields
  user: {
    modelName: "User",
    additionalFields: {
      phone: {
        type: "string",
        required: false,
      },
      phoneVerified: {
        type: "boolean",
        required: false,
      },
      username: {
        type: "string",
        required: false,
      },
      bio: {
        type: "string",
        required: false,
      },
      location: {
        type: "string",
        required: false,
      },
      dob: {
        type: "date",
        required: false,
      },
      bloodType: {
        type: "string",
        required: false,
      },
      avatar: {
        type: "string",
        required: false,
      },
      coverImage: {
        type: "string",
        required: false,
      },
    },
  },

  // Account configuration
  account: {
    modelName: "Account",
    // When a user signs in with Google using the same email as an
    // existing account, link the provider instead of creating a new user.
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },

  // Plugins
  plugins: [
    bearer(),
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type: _type }) => {
        if (process.env.NODE_ENV === "development") {
          console.log(`\n==================================`);
          console.log(`[DEV] OTP for ${email}: ${_type} → ${otp}`);
          console.log(`==================================\n`);
          return;
        }
        const existing = await prisma.user
          .findFirst({
            where: { email },
            select: { id: true, name: true },
          })
          .catch(() => null);
        const sent = await sendOtpEmail({
          to: email,
          otp,
          name: existing?.name,
          isNewUser: !existing,
        });
        if (!sent) throw new Error("Failed to send OTP email");
      },
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        if (process.env.NODE_ENV === "development") {
          console.log(`\n==================================`);
          console.log(`[DEV] Magic Link for ${email} → ${url}`);
          console.log(`==================================\n`);
          return;
        }

        const parsedUrl = new URL(url);
        const token = parsedUrl.searchParams.get("token");
        // Use a generic deep link that the Expo app will intercept
        const deepLinkUrl = `revvie://magic-link?token=${token}`;

        const existing = await prisma.user
          .findFirst({
            where: { email },
            select: { id: true, name: true },
          })
          .catch(() => null);

        const sent = await sendMagicLinkEmail({
          to: email,
          name: existing?.name,
          magicLinkUrl: deepLinkUrl,
        });

        if (!sent) throw new Error("Failed to send Magic Link email");
      },
    }),
    passkey(),
  ],
});

// Type for auth instance
export type Auth = typeof auth;

/**
 * Get the current session from request headers (no role enrichment).
 */
export async function getCurrentSession(
  req: Request,
): Promise<AuthSession | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session || !session.user) {
    return null;
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image:
        (session.user as any).avatar ?? (session.user as any).image ?? null,
      phone: session.user.phone ?? null,
      roles: [],
    },
    session: {
      id: session.session.id,
      token: session.session.token,
      expiresAt: session.session.expiresAt,
    },
  };
}

/**
 * Middleware to protect routes - requires authentication
 * Supports both Better Auth session cookies AND Bearer tokens (for mobile)
 * The bearer() plugin converts Authorization headers to session cookies
 * so auth.api.getSession() handles both flows.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // The bearer plugin converts Authorization: Bearer <token> into a session
    // cookie so getSession() works for both web (cookies) and mobile (Bearer).
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session || !session.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required. Please sign in.",
        error: {
          code: "UNAUTHORIZED",
          details: {
            hint: "Include session cookie or Bearer token in your request",
          },
        },
      });
      return;
    }

    // Get user roles from database
    const assignments = await prisma.userRoleAssignment.findMany({
      where: { userId: session.user.id },
      select: { role: true },
    });

    const roles = assignments.map((a) => a.role);

    // Attach session to request
    req.session = {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image:
          (session.user as any).avatar ?? (session.user as any).image ?? null,
        phone: (session.user as any).phone || null,
        roles,
      },
      session: {
        id: session.session.id,
        token: session.session.token,
        expiresAt: session.session.expiresAt,
      },
    };

    next();
  } catch (error) {
    console.error("[Auth] Session error:", error);
    // Don't log the user out on network/db errors during session validation
    res.status(500).json({
      success: false,
      message: "An internal error occurred during authentication",
      error: {
        code: "AUTH_INTERNAL_ERROR",
        details: {
          hint: "Please try again later",
        },
      },
    });
  }
}

/**
 * Optional auth middleware - extracts session if provided, but doesn't require it
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (session?.user) {
      const assignments = await prisma.userRoleAssignment.findMany({
        where: { userId: session.user.id },
        select: { role: true },
      });

      const roles = assignments.map((a) => a.role);

      req.session = {
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          image:
            (session.user as any).avatar ?? (session.user as any).image ?? null,
          phone: (session.user as any).phone || null,
          roles,
        },
        session: {
          id: session.session.id,
          token: session.session.token,
          expiresAt: session.session.expiresAt,
        },
      };
    }
  } catch {
    // Ignore errors for optional auth
  }

  next();
}

/**
 * Middleware to require specific roles
 */
export function requireRoles(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session?.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
        error: { code: "UNAUTHORIZED" },
      });
      return;
    }

    const userRoles = req.session.user.roles;
    const hasRequiredRole = allowedRoles.some((role) =>
      userRoles.includes(role),
    );

    if (!hasRequiredRole) {
      res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
        error: {
          code: "FORBIDDEN",
          details: {
            required: allowedRoles,
            current: userRoles,
          },
        },
      });
      return;
    }

    next();
  };
}
