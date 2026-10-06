import prisma from "../lib/prisma.js";

/**
 * URL-friendly slug generator.
 */
export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/&/g, "-and-") // Replace & with 'and'
    .replace(/[^\w\-]+/g, "") // Remove all non-word chars
    .replace(/\-\-+/g, "-") // Replace multiple - with single -
    .replace(/^-+/, "") // Trim - from start
    .replace(/-+$/, ""); // Trim - from end
}

export interface BackfillSummary {
  platformCreated: boolean;
  clubsBackfilled: number;
  businessesBackfilled: number;
  membershipsCreated: number;
}

export async function runBackfill(
  rootDomain = process.env.ROOT_DOMAIN || process.env.NEXT_PUBLIC_ROOT_DOMAIN || "revvie.xride-labs.in",
): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    platformCreated: false,
    clubsBackfilled: 0,
    businessesBackfilled: 0,
    membershipsCreated: 0,
  };

  console.log(`[BACKFILL] Starting organization backfill for rootDomain: ${rootDomain}`);

  // 1. Platform Organization
  let platformOrg = await prisma.organization.findUnique({
    where: { slug: "admin" },
  });

  if (!platformOrg) {
    platformOrg = await prisma.organization.create({
      data: {
        name: "Revvie Platform",
        slug: "admin",
        type: "PLATFORM",
        status: "ACTIVE",
        domains: {
          create: {
            hostname: `admin.${rootDomain}`,
            isPrimary: true,
          },
        },
      },
    });
    summary.platformCreated = true;
    console.log(`[BACKFILL] Created Platform organization: admin.${rootDomain}`);
  } else {
    // Ensure primary domain exists
    const domain = await prisma.organizationDomain.findUnique({
      where: { hostname: `admin.${rootDomain}` },
    });
    if (!domain) {
      await prisma.organizationDomain.create({
        data: {
          organizationId: platformOrg.id,
          hostname: `admin.${rootDomain}`,
          isPrimary: true,
        },
      });
    }
  }

  // 2. Clubs
  const clubs = await prisma.club.findMany({
    where: {
      OR: [{ organizationId: null }, { slug: null }],
    },
    include: {
      members: true,
    },
  });

  for (const club of clubs) {
    let candidateSlug = club.slug || slugify(club.name);
    if (!candidateSlug) {
      candidateSlug = `club-${club.id.slice(-6)}`;
    }

    // Ensure uniqueness
    let finalSlug = candidateSlug;
    let counter = 1;
    while (true) {
      const existing = await prisma.organization.findUnique({
        where: { slug: finalSlug },
      });
      if (!existing || existing.id === club.organizationId) {
        break;
      }
      finalSlug = `${candidateSlug}-${counter}`;
      counter++;
    }

    let orgId = club.organizationId;
    if (!orgId) {
      const org = await prisma.organization.create({
        data: {
          name: club.name,
          slug: finalSlug,
          type: "CLUB",
          status: "ACTIVE",
          domains: {
            create: {
              hostname: `${finalSlug}.${rootDomain}`,
              isPrimary: true,
            },
          },
        },
      });
      orgId = org.id;
    } else {
      await prisma.organization.update({
        where: { id: orgId },
        data: { slug: finalSlug },
      });
    }

    await prisma.club.update({
      where: { id: club.id },
      data: {
        slug: finalSlug,
        organizationId: orgId,
      },
    });

    summary.clubsBackfilled++;

    // Sync club members to organization memberships
    for (const member of club.members) {
      const existingMembership = await prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId: member.userId,
          },
        },
      });

      if (!existingMembership) {
        await prisma.organizationMembership.create({
          data: {
            organizationId: orgId,
            userId: member.userId,
            roleId: member.roleId,
            status: "ACTIVE",
          },
        });
        summary.membershipsCreated++;
      }
    }
  }

  // 3. Businesses / Brands
  const businesses = await prisma.businessProfile.findMany({
    where: {
      organizationId: null,
    },
    include: {
      members: true,
    },
  });

  for (const business of businesses) {
    const isBrand = business.categories.includes("BRAND");
    const orgType = isBrand ? "BRAND" : "BUSINESS";

    let finalSlug = business.slug;
    let counter = 1;
    while (true) {
      const existing = await prisma.organization.findUnique({
        where: { slug: finalSlug },
      });
      if (!existing) {
        break;
      }
      finalSlug = `${business.slug}-${counter}`;
      counter++;
    }

    const org = await prisma.organization.create({
      data: {
        name: business.displayName,
        slug: finalSlug,
        type: orgType,
        status: "ACTIVE",
        domains: {
          create: {
            hostname: `${finalSlug}.${rootDomain}`,
            isPrimary: true,
          },
        },
      },
    });

    await prisma.businessProfile.update({
      where: { id: business.id },
      data: {
        organizationId: org.id,
      },
    });

    summary.businessesBackfilled++;

    // Sync brand members to organization memberships
    for (const member of business.members) {
      const existingMembership = await prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: org.id,
            userId: member.userId,
          },
        },
      });

      if (!existingMembership) {
        await prisma.organizationMembership.create({
          data: {
            organizationId: org.id,
            userId: member.userId,
            roleId: member.roleId,
            status: "ACTIVE",
          },
        });
        summary.membershipsCreated++;
      }
    }
  }

  console.log(`[BACKFILL] Completed:`, summary);
  return summary;
}

// Direct execution from CLI
if (process.argv[1]?.endsWith("backfill-organizations.ts")) {
  runBackfill()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[BACKFILL] Failed:", err);
      process.exit(1);
    });
}
