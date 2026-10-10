import "dotenv/config";
import {
  OrganizationStatus,
  OrganizationType,
  PrismaClient,
  RoleScope,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Creates the public city chapters used to populate club discovery in India.
 *
 * This script is deliberately idempotent: it updates only its own deterministic
 * `revvie-*-riders` clubs and can safely be re-run as new areas are added.
 * Production writes require an explicit `--apply` flag.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ROOT_DOMAIN = (
  process.env.ROOT_DOMAIN ||
  process.env.NEXT_PUBLIC_ROOT_DOMAIN ||
  "revvie.xride-labs.in"
).toLowerCase();

const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
const apply = process.argv.includes("--apply");

const COVER_URLS = [
  "https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1600&q=85",
  "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=1600&q=85",
  "https://images.unsplash.com/photo-1449426468159-d96dbf08f19f?auto=format&fit=crop&w=1600&q=85",
  "https://images.unsplash.com/photo-1515238152791-8216bfdf89a7?auto=format&fit=crop&w=1600&q=85",
  "https://images.unsplash.com/photo-1580310614729-ccd69652491d?auto=format&fit=crop&w=1600&q=85",
] as const;

interface Chapter {
  area: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
}

const chapters: Chapter[] = [
  // Bengaluru neighbourhood chapters
  { area: "Koramangala", city: "Bengaluru", state: "Karnataka", latitude: 12.9352, longitude: 77.6245 },
  { area: "Indiranagar", city: "Bengaluru", state: "Karnataka", latitude: 12.9784, longitude: 77.6408 },
  { area: "HSR Layout", city: "Bengaluru", state: "Karnataka", latitude: 12.9116, longitude: 77.6474 },
  { area: "Whitefield", city: "Bengaluru", state: "Karnataka", latitude: 12.9698, longitude: 77.7500 },
  { area: "Electronic City", city: "Bengaluru", state: "Karnataka", latitude: 12.8456, longitude: 77.6603 },
  { area: "Jayanagar", city: "Bengaluru", state: "Karnataka", latitude: 12.9250, longitude: 77.5838 },
  { area: "Malleshwaram", city: "Bengaluru", state: "Karnataka", latitude: 13.0035, longitude: 77.5702 },
  { area: "Rajajinagar", city: "Bengaluru", state: "Karnataka", latitude: 12.9917, longitude: 77.5549 },
  { area: "Hebbal", city: "Bengaluru", state: "Karnataka", latitude: 13.0358, longitude: 77.5970 },
  { area: "Yelahanka", city: "Bengaluru", state: "Karnataka", latitude: 13.1007, longitude: 77.5963 },
  { area: "Banashankari", city: "Bengaluru", state: "Karnataka", latitude: 12.9255, longitude: 77.5468 },
  { area: "Kengeri", city: "Bengaluru", state: "Karnataka", latitude: 12.9166, longitude: 77.4858 },
  { area: "Marathahalli", city: "Bengaluru", state: "Karnataka", latitude: 12.9569, longitude: 77.7011 },
  { area: "Sarjapur", city: "Bengaluru", state: "Karnataka", latitude: 12.9099, longitude: 77.6936 },
  { area: "JP Nagar", city: "Bengaluru", state: "Karnataka", latitude: 12.9063, longitude: 77.5857 },
  { area: "Bengaluru Central", city: "Bengaluru", state: "Karnataka", latitude: 12.9716, longitude: 77.5946 },

  // Major Indian riding cities
  { area: "Mumbai", city: "Mumbai", state: "Maharashtra", latitude: 19.0760, longitude: 72.8777 },
  { area: "Delhi", city: "New Delhi", state: "Delhi", latitude: 28.6139, longitude: 77.2090 },
  { area: "Gurugram", city: "Gurugram", state: "Haryana", latitude: 28.4595, longitude: 77.0266 },
  { area: "Noida", city: "Noida", state: "Uttar Pradesh", latitude: 28.5355, longitude: 77.3910 },
  { area: "Pune", city: "Pune", state: "Maharashtra", latitude: 18.5204, longitude: 73.8567 },
  { area: "Hyderabad", city: "Hyderabad", state: "Telangana", latitude: 17.3850, longitude: 78.4867 },
  { area: "Chennai", city: "Chennai", state: "Tamil Nadu", latitude: 13.0827, longitude: 80.2707 },
  { area: "Kolkata", city: "Kolkata", state: "West Bengal", latitude: 22.5726, longitude: 88.3639 },
  { area: "Ahmedabad", city: "Ahmedabad", state: "Gujarat", latitude: 23.0225, longitude: 72.5714 },
  { area: "Surat", city: "Surat", state: "Gujarat", latitude: 21.1702, longitude: 72.8311 },
  { area: "Jaipur", city: "Jaipur", state: "Rajasthan", latitude: 26.9124, longitude: 75.7873 },
  { area: "Lucknow", city: "Lucknow", state: "Uttar Pradesh", latitude: 26.8467, longitude: 80.9462 },
  { area: "Chandigarh", city: "Chandigarh", state: "Chandigarh", latitude: 30.7333, longitude: 76.7794 },
  { area: "Kochi", city: "Kochi", state: "Kerala", latitude: 9.9312, longitude: 76.2673 },
  { area: "Coimbatore", city: "Coimbatore", state: "Tamil Nadu", latitude: 11.0168, longitude: 76.9558 },
  { area: "Panaji", city: "Panaji", state: "Goa", latitude: 15.4909, longitude: 73.8278 },
  { area: "Bhubaneswar", city: "Bhubaneswar", state: "Odisha", latitude: 20.2961, longitude: 85.8245 },
  { area: "Indore", city: "Indore", state: "Madhya Pradesh", latitude: 22.7196, longitude: 75.8577 },
  { area: "Nagpur", city: "Nagpur", state: "Maharashtra", latitude: 21.1458, longitude: 79.0882 },
  { area: "Visakhapatnam", city: "Visakhapatnam", state: "Andhra Pradesh", latitude: 17.6868, longitude: 83.2185 },
  { area: "Thiruvananthapuram", city: "Thiruvananthapuram", state: "Kerala", latitude: 8.5241, longitude: 76.9366 },
  { area: "Mangaluru", city: "Mangaluru", state: "Karnataka", latitude: 12.9141, longitude: 74.8560 },
  { area: "Mysuru", city: "Mysuru", state: "Karnataka", latitude: 12.2958, longitude: 76.6394 },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureRole(
  slug: string,
  scope: RoleScope,
  name: string,
  color: string,
): Promise<string> {
  const existing = await prisma.role.findFirst({
    where: { slug, scope, scopeId: null },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await prisma.role.create({
    data: {
      name,
      slug,
      scope,
      isSystem: true,
      color,
      icon: "shield",
      priority: scope === RoleScope.GLOBAL ? 100 : 90,
    },
    select: { id: true },
  });

  return created.id;
}

async function main(): Promise<void> {
  if (!ownerEmail) {
    throw new Error("SEED_OWNER_EMAIL must name an existing account.");
  }

  if (!apply) {
    console.log(
      JSON.stringify({
        dryRun: true,
        clubsPlanned: chapters.length,
        bengaluruNeighbourhoodChapters: chapters.filter((chapter) => chapter.city === "Bengaluru").length,
        cityChapters: chapters.filter((chapter) => chapter.city !== "Bengaluru").length,
        rootDomain: ROOT_DOMAIN,
      }),
    );
    return;
  }

  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: { id: true },
  });

  if (!owner) {
    throw new Error("The requested seed owner does not exist.");
  }

  const [superAdminRoleId, adminRoleId, clubOwnerRoleId, riderRoleId, clubRoleId] =
    await Promise.all([
      ensureRole("super_admin", RoleScope.GLOBAL, "Super Administrator", "#ef4444"),
      ensureRole("admin", RoleScope.GLOBAL, "Administrator", "#f97316"),
      ensureRole("club_owner", RoleScope.GLOBAL, "Club Owner", "#3b82f6"),
      ensureRole("rider", RoleScope.GLOBAL, "Active Rider", "#22c55e"),
      ensureRole("owner", RoleScope.CLUB, "Founder / Owner", "#3b82f6"),
    ]);

  await prisma.userRoleAssignment.createMany({
    data: [
      { userId: owner.id, roleId: superAdminRoleId, assignedById: owner.id },
      { userId: owner.id, roleId: adminRoleId, assignedById: owner.id },
      { userId: owner.id, roleId: clubOwnerRoleId, assignedById: owner.id },
      { userId: owner.id, roleId: riderRoleId, assignedById: owner.id },
    ],
    skipDuplicates: true,
  });

  let created = 0;
  let updated = 0;

  for (const [index, chapter] of chapters.entries()) {
    const slug = `revvie-${slugify(chapter.area)}-riders`;
    const existingClub = await prisma.club.findUnique({
      where: { slug },
      select: { id: true },
    });
    const coverImage = COVER_URLS[index % COVER_URLS.length];
    const secondaryImage = COVER_URLS[(index + 1) % COVER_URLS.length];
    const location = `${chapter.area}, ${chapter.city}, ${chapter.state}, India`;
    const name = `Revvie ${chapter.area} Riders`;

    await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.upsert({
        where: { slug },
        create: {
          name,
          slug,
          type: OrganizationType.CLUB,
          status: OrganizationStatus.ACTIVE,
          metadata: {
            seed: "india-public-clubs",
            area: chapter.area,
            city: chapter.city,
            state: chapter.state,
          },
        },
        update: {
          name,
          type: OrganizationType.CLUB,
          status: OrganizationStatus.ACTIVE,
          metadata: {
            seed: "india-public-clubs",
            area: chapter.area,
            city: chapter.city,
            state: chapter.state,
          },
        },
      });

      await tx.organizationDomain.upsert({
        where: { hostname: `${slug}.${ROOT_DOMAIN}` },
        create: {
          organizationId: organization.id,
          hostname: `${slug}.${ROOT_DOMAIN}`,
          isPrimary: true,
          isCustom: false,
        },
        update: {
          organizationId: organization.id,
          isPrimary: true,
          isCustom: false,
        },
      });

      const club = await tx.club.upsert({
        where: { slug },
        create: {
          name,
          slug,
          description: `Public riding community for riders around ${chapter.area}. Weekend loops, breakfast rides, safety-first meetups, and route planning.`,
          location,
          establishedAt: new Date("2026-10-10T00:00:00.000Z"),
          verified: true,
          image: coverImage,
          coverImage,
          clubType: "City Riding Community",
          isPublic: true,
          requiresLicense: false,
          joinPolicy: "OPEN",
          memberCount: 1,
          trophies: [],
          trophyCount: 0,
          gallery: [coverImage, secondaryImage],
          isFeatured: chapter.city === "Bengaluru" || ["Mumbai", "New Delhi", "Pune", "Hyderabad", "Chennai"].includes(chapter.city),
          latitude: chapter.latitude,
          longitude: chapter.longitude,
          ownerId: owner.id,
          organizationId: organization.id,
        },
        update: {
          name,
          description: `Public riding community for riders around ${chapter.area}. Weekend loops, breakfast rides, safety-first meetups, and route planning.`,
          location,
          verified: true,
          image: coverImage,
          coverImage,
          clubType: "City Riding Community",
          isPublic: true,
          requiresLicense: false,
          joinPolicy: "OPEN",
          gallery: [coverImage, secondaryImage],
          isFeatured: chapter.city === "Bengaluru" || ["Mumbai", "New Delhi", "Pune", "Hyderabad", "Chennai"].includes(chapter.city),
          latitude: chapter.latitude,
          longitude: chapter.longitude,
          ownerId: owner.id,
          organizationId: organization.id,
        },
        select: { id: true },
      });

      await tx.clubMember.upsert({
        where: { clubId_userId: { clubId: club.id, userId: owner.id } },
        create: {
          clubId: club.id,
          userId: owner.id,
          roleId: clubRoleId,
          status: "ACTIVE",
        },
        update: {
          roleId: clubRoleId,
          status: "ACTIVE",
          mutedUntil: null,
          suspendedUntil: null,
          bannedUntil: null,
        },
      });

      await tx.organizationMembership.upsert({
        where: {
          organizationId_userId: {
            organizationId: organization.id,
            userId: owner.id,
          },
        },
        create: {
          organizationId: organization.id,
          userId: owner.id,
          roleId: clubRoleId,
          status: "ACTIVE",
        },
        update: { roleId: clubRoleId, status: "ACTIVE" },
      });

      const memberCount = await tx.clubMember.count({
        where: { clubId: club.id, status: "ACTIVE" },
      });
      await tx.club.update({ where: { id: club.id }, data: { memberCount } });
    });

    if (existingClub) updated += 1;
    else created += 1;
  }

  console.log(
    JSON.stringify({
      clubsCreated: created,
      clubsUpdated: updated,
      totalClubsManaged: chapters.length,
      globalRolesEnsured: 4,
      clubOwnerRoleEnsured: true,
      domainsEnsured: chapters.length,
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
