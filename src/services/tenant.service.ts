import prisma from "../lib/prisma.js";
import { isReservedSubdomain, RESERVED_SUBDOMAINS } from "../lib/constants/reservedSubdomains.js";

export { isReservedSubdomain, RESERVED_SUBDOMAINS };

export type TenantType = "PLATFORM" | "BRAND" | "CLUB" | "BUSINESS" | "CONSUMER";

export interface TenantContext {
  type: TenantType;
  organizationId?: string;
  slug?: string;
  name?: string;
  status?: "ACTIVE" | "SUSPENDED" | "PENDING_REVIEW" | "ARCHIVED";
  isPlatform: boolean;
  isConsumer: boolean;
  clubId?: string;
  businessId?: string;
}

export interface TenantResolutionResult {
  found: boolean;
  tenant: TenantContext;
}

/**
 * Normalizes host strings: strips port, trims, converts to lowercase, and strips www.
 */
export function normalizeHost(rawHost: string): string {
  if (!rawHost) return "";
  let host = rawHost.trim().toLowerCase();
  // Strip port
  if (host.includes(":")) {
    host = host.split(":")[0];
  }
  // Strip www. prefix
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }
  return host;
}

/**
 * Extracts the tenant subdomain relative to the configured root domain.
 * Returns null if the host is the root domain itself or doesn't match.
 */
export function extractSubdomain(normalizedHost: string, rootDomain: string): string | null {
  const normHost = normalizeHost(normalizedHost);
  const normRoot = normalizeHost(rootDomain);

  if (normHost === normRoot) {
    return null;
  }

  const suffix = `.${normRoot}`;
  if (normHost.endsWith(suffix)) {
    const sub = normHost.slice(0, -suffix.length);
    return sub.length > 0 ? sub : null;
  }

  return null;
}

export class TenantService {
  /**
   * Resolves a tenant context from an incoming request host header.
   */
  static async resolveFromHost(
    rawHost: string,
    customRootDomain?: string,
  ): Promise<TenantResolutionResult> {
    const rootDomain =
      customRootDomain ||
      process.env.ROOT_DOMAIN ||
      process.env.NEXT_PUBLIC_ROOT_DOMAIN ||
      "revvie.xride-labs.in";

    const host = normalizeHost(rawHost);
    const normRoot = normalizeHost(rootDomain);

    // 1. Root Domain -> Consumer Application
    if (host === normRoot || !host) {
      return {
        found: true,
        tenant: {
          type: "CONSUMER",
          isConsumer: true,
          isPlatform: false,
        },
      };
    }

    const subdomain = extractSubdomain(host, normRoot);

    // 2. Admin Subdomain -> Platform Administration
    if (subdomain === "admin") {
      const platformOrg = await prisma.organization.findUnique({
        where: { slug: "admin" },
      });

      return {
        found: true,
        tenant: {
          type: "PLATFORM",
          organizationId: platformOrg?.id,
          slug: "admin",
          name: platformOrg?.name || "Revvie Platform Administration",
          status: platformOrg?.status || "ACTIVE",
          isPlatform: true,
          isConsumer: false,
        },
      };
    }

    // 3. Database Domain Lookup
    const domainRecord = await prisma.organizationDomain.findUnique({
      where: { hostname: host },
      include: {
        organization: {
          include: {
            club: { select: { id: true } },
            businessProfile: { select: { id: true } },
          },
        },
      },
    });

    if (domainRecord && domainRecord.organization) {
      const org = domainRecord.organization;
      return {
        found: true,
        tenant: {
          type: org.type,
          organizationId: org.id,
          slug: org.slug,
          name: org.name,
          status: org.status,
          isPlatform: false,
          isConsumer: false,
          clubId: org.club?.id,
          businessId: org.businessProfile?.id,
        },
      };
    }

    // 4. Fallback lookup by subdomain slug if domain record not populated
    if (subdomain && !isReservedSubdomain(subdomain)) {
      const orgBySlug = await prisma.organization.findUnique({
        where: { slug: subdomain },
        include: {
          club: { select: { id: true } },
          businessProfile: { select: { id: true } },
        },
      });

      if (orgBySlug) {
        return {
          found: true,
          tenant: {
            type: orgBySlug.type,
            organizationId: orgBySlug.id,
            slug: orgBySlug.slug,
            name: orgBySlug.name,
            status: orgBySlug.status,
            isPlatform: false,
            isConsumer: false,
            clubId: orgBySlug.club?.id,
            businessId: orgBySlug.businessProfile?.id,
          },
        };
      }
    }

    // 5. Unknown Host
    return {
      found: false,
      tenant: {
        type: "CONSUMER",
        isConsumer: true,
        isPlatform: false,
      },
    };
  }

  /**
   * Resolves a tenant context directly by organization slug.
   */
  static async resolveBySlug(slug: string): Promise<TenantResolutionResult> {
    const normalized = (slug || "").toLowerCase().trim();
    if (!normalized) {
      return {
        found: false,
        tenant: { type: "CONSUMER", isConsumer: true, isPlatform: false },
      };
    }

    const org = await prisma.organization.findUnique({
      where: { slug: normalized },
      include: {
        club: { select: { id: true } },
        businessProfile: { select: { id: true } },
      },
    });

    if (!org) {
      return {
        found: false,
        tenant: { type: "CONSUMER", isConsumer: true, isPlatform: false },
      };
    }

    return {
      found: true,
      tenant: {
        type: org.type,
        organizationId: org.id,
        slug: org.slug,
        name: org.name,
        status: org.status,
        isPlatform: org.type === "PLATFORM",
        isConsumer: false,
        clubId: org.club?.id,
        businessId: org.businessProfile?.id,
      },
    };
  }

  /**
   * Retrieves active membership for a user in an organization.
   */
  static async getMembership(userId: string, organizationId: string) {
    return prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });
  }
}
