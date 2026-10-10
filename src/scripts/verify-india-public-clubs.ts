import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
if (!ownerEmail) {
  throw new Error("SEED_OWNER_EMAIL must name the expected club owner.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main(): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: { id: true },
  });
  const clubs = await prisma.club.findMany({
    where: { slug: { startsWith: "revvie-", endsWith: "-riders" } },
    select: {
      ownerId: true,
      isPublic: true,
      verified: true,
      organizationId: true,
      members: {
        where: { userId: owner?.id },
        select: { role: { select: { slug: true } }, status: true },
      },
      organization: {
        select: {
          domains: { where: { isPrimary: true }, select: { hostname: true } },
          memberships: {
            where: { userId: owner?.id },
            select: { role: { select: { slug: true } }, status: true },
          },
        },
      },
    },
  });
  const roles = owner
    ? await prisma.userRoleAssignment.findMany({
        where: { userId: owner.id },
        select: { roleRecord: { select: { slug: true } } },
      })
    : [];

  console.log(
    JSON.stringify({
      userFound: Boolean(owner),
      seededClubs: clubs.length,
      clubsWithRequestedOwner: clubs.filter((club) => club.ownerId === owner?.id).length,
      publicVerifiedClubs: clubs.filter((club) => club.isPublic && club.verified).length,
      clubsWithOrganizations: clubs.filter((club) => club.organizationId).length,
      primaryDomains: clubs.filter((club) => club.organization?.domains.length).length,
      ownerMemberships: clubs.filter((club) =>
        club.members.some(
          (member) => member.status === "ACTIVE" && member.role.slug === "owner",
        ),
      ).length,
      organizationOwnerMemberships: clubs.filter((club) =>
        club.organization?.memberships.some(
          (member) => member.status === "ACTIVE" && member.role.slug === "owner",
        ),
      ).length,
      globalRoles: roles.map(({ roleRecord }) => roleRecord.slug).sort(),
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
