import "dotenv/config";
import {
  PrismaClient,
  ListingStatus,
  ListingOfferStatus,
  NotificationType,
  EventStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import mongoose, { connectMongoDB } from "../src/lib/mongodb.js";
import {
  Conversation,
  ConversationType,
  Message,
  MessageType,
  ParticipantRole,
  UnreadCount,
} from "../src/models/chat.model.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const IS_PROD = process.env.NODE_ENV === "production";
const PRIMARY_ADMIN_EMAIL = "admin@revvie.in";
const GOOGLE_ADMIN_EMAIL = "krithikm923@gmail.com";

// ──────────────────────────────────────────────────────────────────
// Public CDN media — Unsplash / Pexels. Free to hotlink for demos.
// Having real image URLs in seed data is important because empty
// `images: []` arrays render as grey boxes across the app.
// ──────────────────────────────────────────────────────────────────
const AVATAR_URLS = [
  "https://randomuser.me/api/portraits/men/32.jpg",
  "https://randomuser.me/api/portraits/women/44.jpg",
  "https://randomuser.me/api/portraits/men/75.jpg",
  "https://randomuser.me/api/portraits/women/68.jpg",
  "https://randomuser.me/api/portraits/men/51.jpg",
  "https://randomuser.me/api/portraits/women/12.jpg",
  "https://randomuser.me/api/portraits/men/85.jpg",
  "https://randomuser.me/api/portraits/women/29.jpg",
  "https://randomuser.me/api/portraits/men/19.jpg",
  "https://randomuser.me/api/portraits/women/57.jpg",
];

const COVER_URLS = [
  "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=1200",
  "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=1200",
  "https://images.unsplash.com/photo-1449426468159-d96dbf08f19f?w=1200",
  "https://images.unsplash.com/photo-1515238152791-8216bfdf89a7?w=1200",
  "https://images.unsplash.com/photo-1580310614729-ccd69652491d?w=1200",
];

const LISTING_IMAGES: Record<string, string[]> = {
  Helmet: [
    "https://images.unsplash.com/photo-1609630875171-b1321377ee65?w=800",
    "https://images.unsplash.com/photo-1591637333184-19aa84b3e01f?w=800",
  ],
  Jacket: [
    "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800",
    "https://images.unsplash.com/photo-1520975916090-3105956dac38?w=800",
  ],
  Gloves: [
    "https://images.unsplash.com/photo-1587731556938-38755b4803a6?w=800",
  ],
  Boots: ["https://images.unsplash.com/photo-1520639888713-7851133b1ed0?w=800"],
  Armor: ["https://images.unsplash.com/photo-1558980394-0a0c5f5a1a80?w=800"],
  Motorcycle: [
    "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800",
    "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=800",
    "https://images.unsplash.com/photo-1511994298241-608e28f14fde?w=800",
  ],
  Camera: [
    "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800",
  ],
  Drone: ["https://images.unsplash.com/photo-1507582020474-9a35b7d455d9?w=800"],
  GPS: ["https://images.unsplash.com/photo-1581093588401-fbb62a02f120?w=800"],
  Mount: ["https://images.unsplash.com/photo-1558980664-3a031cf67ea8?w=800"],
  Lights: [
    "https://images.unsplash.com/photo-1581093057305-25b8e4e6e3a3?w=800",
  ],
  Tyres: ["https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?w=800"],
  Exhaust: [
    "https://images.unsplash.com/photo-1580310614729-ccd69652491d?w=800",
  ],
  Filters: [
    "https://images.unsplash.com/photo-1518306727298-4c17e1bf6947?w=800",
  ],
  Guards: [
    "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800",
  ],
  Oil: ["https://images.unsplash.com/photo-1518458028785-8fbcd101ebb9?w=800"],
  Battery: [
    "https://images.unsplash.com/photo-1609697564478-b4a0b98b21c6?w=800",
  ],
  Protective: [
    "https://images.unsplash.com/photo-1520975916090-3105956dac38?w=800",
  ],
  Winter: [
    "https://images.unsplash.com/photo-1540962351504-03099e0a754b?w=800",
  ],
  Luggage: ["https://images.unsplash.com/photo-1553531384-cc64ac80f931?w=800"],
  Tools: ["https://images.unsplash.com/photo-1530124566582-a618bc2615dc?w=800"],
  Pump: ["https://images.unsplash.com/photo-1581091012184-7e0cdfbb6797?w=800"],
  Lock: ["https://images.unsplash.com/photo-1558002038-1055907df827?w=800"],
  Safety: [
    "https://images.unsplash.com/photo-1608889476518-738c9b1dcb40?w=800",
  ],
  Charger: [
    "https://images.unsplash.com/photo-1609592812743-4c6e0eeb6b5f?w=800",
  ],
  Mirror: [
    "https://images.unsplash.com/photo-1525160354320-d8e92641c563?w=800",
  ],
  Adventure: [
    "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800",
  ],
  Backpack: ["https://images.unsplash.com/photo-1553531384-cc64ac80f931?w=800"],
  "Tail Tidy": [
    "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800",
  ],
};

const POST_IMAGES = [
  "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=1200",
  "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=1200",
  "https://images.unsplash.com/photo-1515238152791-8216bfdf89a7?w=1200",
  "https://images.unsplash.com/photo-1449426468159-d96dbf08f19f?w=1200",
  "https://images.unsplash.com/photo-1511994298241-608e28f14fde?w=1200",
  "https://images.unsplash.com/photo-1580310614729-ccd69652491d?w=1200",
];

// City centers (lat/lng). Seed data is geographically distributed so the feed
// isn't empty regardless of where the dev's GPS resolves to. Bangalore still
// gets the heaviest weight because dev testing happens from there.
const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  Bangalore: { lat: 12.9716, lng: 77.5946 },
  Koramangala: { lat: 12.9352, lng: 77.6245 },
  Delhi: { lat: 28.6139, lng: 77.209 },
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Pune: { lat: 18.5204, lng: 73.8567 },
  Chennai: { lat: 13.0827, lng: 80.2707 },
  Hyderabad: { lat: 17.385, lng: 78.4867 },
  Kochi: { lat: 9.9312, lng: 76.2673 },
  Jaipur: { lat: 26.9124, lng: 75.7873 },
};

function pickImage<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function listingImagesFor(subcat: string, seed: number): string[] {
  const pool = LISTING_IMAGES[subcat] ?? LISTING_IMAGES.Motorcycle;
  // 1–2 images per listing, deterministic by seed so reruns stay stable.
  return seed % 3 === 0 && pool.length > 1
    ? [pool[0], pool[1 % pool.length]]
    : [pool[seed % pool.length]];
}

/**
 * Jitter coords around a city center so multiple seed rows in the same city
 * don't stack on one pin. ~2-5km radius, deterministic from `seed`.
 */
function coordsNear(
  city: keyof typeof CITY_CENTERS,
  seed: number,
): { lat: number; lng: number } {
  const c = CITY_CENTERS[city];
  const angle = (seed * 137.5 * Math.PI) / 180; // golden-angle spread
  const dist = 0.01 + ((seed * 7) % 17) * 0.003; // 1–6km
  return {
    lat: c.lat + Math.sin(angle) * dist,
    lng: c.lng + Math.cos(angle) * dist,
  };
}

async function ensureGoogleAdminSeedUser(): Promise<void> {
  const googleAdmin = await prisma.user.upsert({
    where: { email: GOOGLE_ADMIN_EMAIL },
    update: {
      name: "Krithik M",
      emailVerified: true,
      subscriptionTier: "PRO",
    },
    create: {
      email: GOOGLE_ADMIN_EMAIL,
      name: "Krithik M",
      emailVerified: true,
      bio: "Platform admin user",
      location: "Bangalore, India",
      subscriptionTier: "PRO",
    },
  });

  await prisma.userRoleAssignment.createMany({
    data: [
      { userId: googleAdmin.id, role: "ADMIN" as const },
      { userId: googleAdmin.id, role: "RIDER" as const },
    ],
    skipDuplicates: true,
  });

  console.log(`✅ Ensured ${GOOGLE_ADMIN_EMAIL} has ADMIN + RIDER roles`);
}

async function seedProductionAdmin(passwordHash: string): Promise<void> {
  console.log("🌱 Running production-safe seed (no destructive deletes)...");

  const adminUser = await prisma.user.upsert({
    where: { email: PRIMARY_ADMIN_EMAIL },
    update: {
      name: "Admin User",
      emailVerified: true,
      phoneVerified: true,
      bio: "Platform administrator & club manager",
      location: "Mumbai, India",
      dob: new Date("1992-02-01"),
      bloodType: "O+",
      avatar:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772386875/revvie/rides/avatar_hgoxkz.jpg",
      coverImage:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772387502/revvie/rides/bannerBackgroundImage_o8qnzwji8ckd1_rynbjl.png",
      xpPoints: 5200,
      level: 12,
      levelTitle: "Road Commander",
      activityLevel: "Enthusiast",
      reputationScore: 5.0,
      helmetVerified: true,
      lastSafetyCheck: new Date("2026-01-12"),
      // Admin must always stay lifetime-free.
      subscriptionTier: "PRO",
    },
    create: {
      email: PRIMARY_ADMIN_EMAIL,
      name: "Admin User",
      emailVerified: true,
      phoneVerified: true,
      bio: "Platform administrator & club manager",
      location: "Mumbai, India",
      dob: new Date("1992-02-01"),
      bloodType: "O+",
      avatar:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772386875/revvie/rides/avatar_hgoxkz.jpg",
      coverImage:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772387502/revvie/rides/bannerBackgroundImage_o8qnzwji8ckd1_rynbjl.png",
      xpPoints: 5200,
      level: 12,
      levelTitle: "Road Commander",
      activityLevel: "Enthusiast",
      reputationScore: 5.0,
      helmetVerified: true,
      lastSafetyCheck: new Date("2026-01-12"),
      subscriptionTier: "PRO",
    },
  });

  await ensureGoogleAdminSeedUser();

  await prisma.userRoleAssignment.createMany({
    data: [
      { userId: adminUser.id, role: "ADMIN" as const },
      { userId: adminUser.id, role: "CLUB_OWNER" as const },
    ],
    skipDuplicates: true,
  });

  await prisma.account.upsert({
    where: {
      providerId_accountId: {
        providerId: "credential",
        accountId: adminUser.id,
      },
    },
    update: {
      userId: adminUser.id,
      password: passwordHash,
    },
    create: {
      userId: adminUser.id,
      providerId: "credential",
      accountId: adminUser.id,
      password: passwordHash,
    },
  });

  console.log("✅ Production seed completed safely");
  console.log(`🔑 ${PRIMARY_ADMIN_EMAIL} / password123  -> ADMIN + CLUB_OWNER`);
  console.log(`🟢 ${GOOGLE_ADMIN_EMAIL} -> ADMIN + RIDER`);
}

async function main() {
  console.log(`🌱 Starting ${IS_PROD ? "PRODUCTION" : "DEVELOPMENT"} seed...`);

  const hashedPassword = await hashPassword("password123");

  if (IS_PROD) {
    await seedProductionAdmin(hashedPassword);
    return;
  }

  // Clear existing data
  console.log("🗑️  Clearing existing data...");
  await prisma.review.deleteMany();
  await prisma.eventParticipant.deleteMany();
  await prisma.event.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.listingOffer.deleteMany();
  await prisma.listingInterest.deleteMany();
  await prisma.rideRating.deleteMany();
  await prisma.rideTrackingData.deleteMany();
  await prisma.report.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.like.deleteMany();
  await prisma.post.deleteMany();
  await prisma.userBadge.deleteMany();
  await prisma.badge.deleteMany();
  await prisma.emergencyContact.deleteMany();
  await prisma.userPreferences.deleteMany();
  await prisma.userRideStats.deleteMany();
  await prisma.locationSharePermission.deleteMany();
  await prisma.userLiveLocation.deleteMany();
  await prisma.friendship.deleteMany();
  await prisma.bike.deleteMany();
  await prisma.rideParticipant.deleteMany();
  await prisma.clubMember.deleteMany();
  await prisma.clubJoinRequest.deleteMany();
  await prisma.friendGroupJoinRequest.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.discount.deleteMany();
  await prisma.adCampaign.deleteMany();
  await prisma.marketplaceListing.deleteMany();
  await prisma.businessProfile.deleteMany();
  await prisma.friendGroupMember.deleteMany();
  await prisma.friendGroup.deleteMany();
  await prisma.club.deleteMany();
  await prisma.ride.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.media.deleteMany();
  await prisma.userRoleAssignment.deleteMany();
  await prisma.user.deleteMany();

  // ── Helper ──────────────────────────────────────────────────────
  async function createUserWithRoles(
    data: Parameters<typeof prisma.user.create>[0]["data"],
    roles: string[],
    passwordHash: string,
  ) {
    const user = await prisma.user.create({ data });
    await prisma.userRoleAssignment.createMany({
      data: roles.map((role) => ({ userId: user.id, role: role as any })),
    });
    await prisma.account.create({
      data: {
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: passwordHash,
      },
    });
    return user;
  }

  // ══════════════════════════════════════════════════════════════════
  //  ADMIN USER (always created)
  // ══════════════════════════════════════════════════════════════════
  const adminUser = await createUserWithRoles(
    {
      email: PRIMARY_ADMIN_EMAIL,
      username: "admin",
      name: "Admin User",
      phone: "+1234567890",
      emailVerified: true,
      phoneVerified: true,
      bio: "Platform administrator & club manager",
      location: "Mumbai, India",
      dob: new Date("1992-02-01"),
      bloodType: "O+",
      avatar:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772386875/revvie/rides/avatar_hgoxkz.jpg",
      coverImage:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772387502/revvie/rides/bannerBackgroundImage_o8qnzwji8ckd1_rynbjl.png",
      xpPoints: 5200,
      level: 12,
      levelTitle: "Road Commander",
      activityLevel: "Enthusiast",
      reputationScore: 5.0,
      helmetVerified: true,
      lastSafetyCheck: new Date("2026-01-12"),
      // Admin is explicitly lifetime-free in all environments.
      subscriptionTier: "PRO",
    },
    ["ADMIN", "CLUB_OWNER"],
    hashedPassword,
  );
  console.log("✅ Created admin user:", adminUser.email);

  await ensureGoogleAdminSeedUser();

  // ══════════════════════════════════════════════════════════════════
  //  DEV-ONLY DATA BELOW
  // ══════════════════════════════════════════════════════════════════

  // ── Users ────────────────────────────────────────────────────────
  const devUsers = [
    {
      email: "john@example.com",
      username: "john_rider",
      name: "John Doe",
      phone: "+1234567891",
      bio: "Love riding on weekends!",
      location: "Bangalore, India",
      dob: new Date("1996-04-11"),
      bloodType: "B+",
      avatar:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772560334/revvie/rides/male_doctor_njjg5j.png",
      coverImage:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772560334/revvie/rides/119419735_udtbgq.webp",
      xpPoints: 1200,
      level: 5,
      levelTitle: "Weekend Runner",
      activityLevel: "Regular",
      reputationScore: 4.5,
      helmetVerified: true,
      lastSafetyCheck: new Date("2026-01-05"),
      roles: ["RIDER", "SELLER"],
    },
    {
      email: "sarah@example.com",
      username: "sarah_speed",
      name: "Sarah Johnson",
      phone: "+1234567892",
      bio: "Speed enthusiast and track day lover",
      location: "Delhi, India",
      dob: new Date("1998-09-23"),
      bloodType: "A+",
      avatar:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772560335/revvie/rides/Police_Woman_h2lvlq.png",
      coverImage:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772560336/revvie/rides/IMG_6600_t57x4d.webp",
      xpPoints: 2500,
      level: 8,
      levelTitle: "Track Chaser",
      activityLevel: "Enthusiast",
      reputationScore: 4.8,
      helmetVerified: true,
      lastSafetyCheck: new Date("2026-01-20"),
      roles: ["RIDER", "SELLER"],
    },
    {
      email: "mike@example.com",
      username: "mike_adventure",
      name: "Mike Wilson",
      phone: "+1234567893",
      bio: "Adventure rider exploring India",
      location: "Pune, India",
      dob: new Date("1994-12-02"),
      bloodType: "O-",
      avatar: AVATAR_URLS[2],
      coverImage: COVER_URLS[0],
      xpPoints: 3500,
      level: 10,
      levelTitle: "Trail Boss",
      activityLevel: "Enthusiast",
      reputationScore: 4.7,
      helmetVerified: true,
      lastSafetyCheck: new Date("2026-02-01"),
      roles: ["CLUB_OWNER", "RIDER", "SELLER"],
    },
    {
      email: "lisa@example.com",
      username: "lisa_rider",
      name: "Lisa Brown",
      phone: "+1234567894",
      bio: "Gear enthusiast and marketplace seller",
      location: "Chennai, India",
      dob: new Date("2000-06-14"),
      bloodType: "AB+",
      avatar:
        "https://res.cloudinary.com/xride-labs/image/upload/v1772560334/revvie/rides/male_doctor_njjg5j.png",
      xpPoints: 800,
      level: 3,
      levelTitle: "Starter",
      activityLevel: "Casual",
      reputationScore: 4.3,
      helmetVerified: false,
      roles: ["SELLER", "RIDER"],
    },
    {
      email: "raj@example.com",
      username: "raj_thunder",
      name: "Raj Patel",
      phone: "+1234567895",
      bio: "Thunder lover, long highway cruises",
      location: "Hyderabad, India",
      dob: new Date("1997-07-18"),
      bloodType: "A-",
      avatar: AVATAR_URLS[4],
      coverImage: COVER_URLS[1],
      xpPoints: 1800,
      level: 7,
      levelTitle: "Highway King",
      activityLevel: "Regular",
      reputationScore: 4.4,
      helmetVerified: true,
      lastSafetyCheck: new Date("2026-01-28"),
      roles: ["RIDER"],
    },
    {
      email: "priya@example.com",
      username: "priya_cruiser",
      name: "Priya Sharma",
      phone: "+1234567896",
      bio: "Café racer enthusiast, weekend vibes only",
      location: "Bangalore, India",
      dob: new Date("1999-03-05"),
      bloodType: "B-",
      avatar: AVATAR_URLS[5],
      coverImage: COVER_URLS[2],
      xpPoints: 2100,
      level: 6,
      levelTitle: "Café Racer",
      activityLevel: "Regular",
      reputationScore: 4.6,
      helmetVerified: true,
      lastSafetyCheck: new Date("2026-02-05"),
      roles: ["RIDER", "SELLER"],
    },
    {
      email: "arjun@example.com",
      username: "arjun_offroad",
      name: "Arjun Nair",
      phone: "+1234567897",
      bio: "Offroad trails are my therapy",
      location: "Kochi, India",
      dob: new Date("1995-11-29"),
      bloodType: "O+",
      avatar: AVATAR_URLS[6],
      coverImage: COVER_URLS[3],
      xpPoints: 3100,
      level: 9,
      levelTitle: "Trail Blazer",
      activityLevel: "Enthusiast",
      reputationScore: 4.9,
      helmetVerified: true,
      lastSafetyCheck: new Date("2026-02-10"),
      roles: ["CLUB_OWNER", "RIDER"],
    },
    {
      email: "neha@example.com",
      username: "neha_night",
      name: "Neha Gupta",
      phone: "+1234567898",
      bio: "Night rides through the city lights",
      location: "Mumbai, India",
      dob: new Date("2001-01-15"),
      bloodType: "AB-",
      avatar: AVATAR_URLS[7],
      coverImage: COVER_URLS[4],
      xpPoints: 950,
      level: 4,
      levelTitle: "Night Owl",
      activityLevel: "Casual",
      reputationScore: 4.2,
      helmetVerified: true,
      roles: ["RIDER"],
    },
    {
      email: "vikram@example.com",
      username: "vikram_vroom",
      name: "Vikram Singh",
      phone: "+1234567899",
      bio: "Vintage motorcycle collector and restorer",
      location: "Jaipur, India",
      dob: new Date("1993-08-22"),
      bloodType: "B+",
      avatar: AVATAR_URLS[8],
      coverImage: COVER_URLS[0],
      xpPoints: 4200,
      level: 11,
      levelTitle: "Vintage King",
      activityLevel: "Pro",
      reputationScore: 4.8,
      helmetVerified: true,
      lastSafetyCheck: new Date("2026-01-15"),
      roles: ["CLUB_OWNER", "RIDER", "SELLER"],
    },
  ];

  const createdUsers: any[] = [];
  for (const u of devUsers) {
    const { roles, ...userData } = u;
    const user = await createUserWithRoles(
      {
        ...userData,
        emailVerified: true,
        phoneVerified: !!u.phone,
        subscriptionTier: roles.includes("CLUB_OWNER") ? "PRO" : "FREE",
      },
      roles,
      hashedPassword,
    );
    createdUsers.push(user);
  }
  const allUsers = [adminUser, ...createdUsers];
  const [user1, user2, user3, user4, user5, user6, user7, user8, user9] =
    createdUsers;
  console.log(`✅ Created ${createdUsers.length} dev users`);

  // ── Bikes ────────────────────────────────────────────────────────
  const bikeData = [
    {
      userId: adminUser.id,
      make: "Kawasaki",
      model: "Ninja 650",
      year: 2022,
      type: "SPORT" as const,
      engineCc: 649,
      color: "Emerald Green",
      odo: 5200,
      isPrimary: true,
    },
    {
      userId: user1.id,
      make: "Royal Enfield",
      model: "Classic 350",
      year: 2020,
      type: "CRUISER" as const,
      engineCc: 349,
      color: "Signals Desert Sand",
      odo: 15000,
      isPrimary: true,
    },
    {
      userId: user2.id,
      make: "Yamaha",
      model: "R15 V4",
      year: 2023,
      type: "SPORT" as const,
      engineCc: 155,
      color: "Racing Blue",
      odo: 8450,
      isPrimary: true,
    },
    {
      userId: user3.id,
      make: "KTM",
      model: "390 Adventure",
      year: 2019,
      type: "ADVENTURE" as const,
      engineCc: 373,
      color: "Orange",
      odo: 25000,
      isPrimary: true,
    },
    {
      userId: user4.id,
      make: "KTM",
      model: "Duke 200",
      year: 2021,
      type: "NAKED" as const,
      engineCc: 199,
      color: "White",
      odo: 6400,
      isPrimary: true,
    },
    {
      userId: user5.id,
      make: "Royal Enfield",
      model: "Thunderbird 500",
      year: 2018,
      type: "CRUISER" as const,
      engineCc: 499,
      color: "Black",
      odo: 32000,
      isPrimary: true,
    },
    {
      userId: user6.id,
      make: "Honda",
      model: "CB350 RS",
      year: 2023,
      type: "NAKED" as const,
      engineCc: 348,
      color: "Matte Steel Black",
      odo: 4500,
      isPrimary: true,
    },
    {
      userId: user7.id,
      make: "Hero",
      model: "XPulse 200 4V",
      year: 2024,
      type: "ADVENTURE" as const,
      engineCc: 199,
      color: "Trail Blue",
      odo: 9800,
      isPrimary: true,
    },
    {
      userId: user8.id,
      make: "Bajaj",
      model: "Dominar 400",
      year: 2022,
      type: "TOURING" as const,
      engineCc: 373,
      color: "Aurora Green",
      odo: 11200,
      isPrimary: true,
    },
    {
      userId: user9.id,
      make: "Jawa",
      model: "Classic",
      year: 2020,
      type: "CRUISER" as const,
      engineCc: 293,
      color: "Maroon",
      odo: 18500,
      isPrimary: true,
    },
  ];
  await prisma.bike.createMany({
    data: bikeData.map((b) => ({ ...b, ownerSince: new Date("2022-01-01") })),
  });
  console.log("✅ Created bikes");

  // ── Badges ───────────────────────────────────────────────────────
  const badges = await Promise.all([
    prisma.badge.create({
      data: {
        title: "First Ride",
        description: "Completed your first ride",
        icon: "🏁",
        auraPoints: 100,
        category: "achievement",
      },
    }),
    prisma.badge.create({
      data: {
        title: "1000 KM Club",
        description: "Crossed 1000km total distance",
        icon: "🔥",
        auraPoints: 150,
        category: "distance",
      },
    }),
    prisma.badge.create({
      data: {
        title: "Night Owl",
        description: "Completed 10 night rides",
        icon: "🌙",
        auraPoints: 120,
        category: "activity",
      },
    }),
    prisma.badge.create({
      data: {
        title: "Social Butterfly",
        description: "Made 5 friends on the platform",
        icon: "🦋",
        auraPoints: 80,
        category: "social",
      },
    }),
    prisma.badge.create({
      data: {
        title: "Marketplace Pro",
        description: "Sold 10 items on the marketplace",
        icon: "💰",
        auraPoints: 200,
        category: "marketplace",
      },
    }),
  ]);
  const badgeAssignments = allUsers.flatMap((u, i) => {
    const count = Math.min(2 + (i % 3), badges.length);
    return badges.slice(0, count).map((b) => ({ userId: u.id, badgeId: b.id }));
  });
  await prisma.userBadge.createMany({ data: badgeAssignments });
  console.log("✅ Created badges and user badges");

  // ── Emergency Contacts ───────────────────────────────────────────
  const emergencyNames = [
    "Ravi Kumar",
    "Ananya Singh",
    "Priya Wilson",
    "Suresh Rao",
    "Deepa Iyer",
    "Karthik M",
    "Shreya Das",
    "Mohan L",
    "Arun P",
    "Meera J",
  ];
  await prisma.emergencyContact.createMany({
    data: allUsers.slice(0, 8).map((u, i) => ({
      userId: u.id,
      name: emergencyNames[i],
      phone: `+91${9876543210 + i}`,
      relationship: ["Brother", "Friend", "Spouse", "Parent", "Sister"][i % 5],
      isPrimary: true,
    })),
  });
  console.log("✅ Created emergency contacts");

  // ── Preferences ──────────────────────────────────────────────
  await prisma.userPreferences.createMany({
    data: allUsers.map((u, i) => ({
      userId: u.id,
      rideReminders: i % 3 !== 0,
      serviceReminderKm: 3000 + i * 500,
      darkMode: i % 2 === 0,
      units: "metric",
      openToInvite: i % 4 !== 0,
    })),
  });
  console.log("✅ Created user preferences");

  // ── Ride Stats ───────────────────────────────────────────────
  await prisma.userRideStats.createMany({
    data: allUsers.map((u, i) => ({
      userId: u.id,
      totalDistanceKm: 1000 + i * 800,
      longestRideKm: 150 + i * 40,
      totalRides: 10 + i * 8,
      nightRides: 2 + i * 2,
      weekendRides: 5 + i * 3,
    })),
  });
  console.log("✅ Created ride stats");

  // ── Friendships (at least 5 per user) ────────────────────────
  // Create a mesh where every user is friends with at least 5 others
  const friendshipPairs: {
    senderId: string;
    receiverId: string;
    status: "PENDING" | "ACCEPTED" | "DECLINED" | "BLOCKED";
  }[] = [];
  const friendshipSet = new Set<string>();
  for (let i = 0; i < allUsers.length; i++) {
    // Connect to the next 5 users (wrapping around)
    for (let offset = 1; offset <= 5; offset++) {
      const j = (i + offset) % allUsers.length;
      const key = [allUsers[i].id, allUsers[j].id].sort().join(":");
      if (!friendshipSet.has(key)) {
        friendshipSet.add(key);
        friendshipPairs.push({
          senderId: allUsers[i].id,
          receiverId: allUsers[j].id,
          status: "ACCEPTED" as const,
        });
      }
    }
  }
  // Add a few pending requests too
  friendshipPairs.push(
    { senderId: user5.id, receiverId: user9.id, status: "PENDING" as const },
    { senderId: user8.id, receiverId: user6.id, status: "PENDING" as const },
  );
  await prisma.friendship.createMany({
    data: friendshipPairs,
    skipDuplicates: true,
  });
  console.log(`✅ Created ${friendshipPairs.length} friendships (≥5 per user)`);

  // ── Follows ──────────────────────────────────────────────────
  const followData: { followerId: string; followingId: string }[] = [];
  const followSet = new Set<string>();
  for (let i = 0; i < allUsers.length; i++) {
    for (let offset = 1; offset <= 3; offset++) {
      const j = (i + offset) % allUsers.length;
      const key = `${allUsers[i].id}:${allUsers[j].id}`;
      if (!followSet.has(key) && allUsers[i].id !== allUsers[j].id) {
        followSet.add(key);
        followData.push({
          followerId: allUsers[i].id,
          followingId: allUsers[j].id,
        });
      }
    }
  }
  await prisma.follow.createMany({ data: followData, skipDuplicates: true });
  console.log(`✅ Created ${followData.length} follows`);

  // ── Bangalore Coordinates (centered on Koramangala) ────────────────────────────────────
  // Koramangala is at approximately 12.9352° N, 77.6245° E
  // Using Bangalore as base for names/descriptions, but concentrating coordinates on Koramangala
  const koramangalaBase = { lat: 12.9352, lng: 77.6245 };

  function generateBangaloreCoords(index: number) {
    // Generate 70% of coordinates VERY close to Koramangala (1-15km) for discovery
    // 30% spread across Bangalore for variety
    if (index < 90) {
      // Heavy concentration around Koramangala (close)
      const angle = (index / 90) * Math.PI * 2;
      const distance = 0.05 + Math.random() * 0.15; // 0-16km roughly
      return {
        lat:
          koramangalaBase.lat +
          Math.sin(angle) * distance +
          (Math.random() - 0.5) * 0.02,
        lng:
          koramangalaBase.lng +
          Math.cos(angle) * distance +
          (Math.random() - 0.5) * 0.02,
      };
    } else {
      // Spread across larger Bangalore area
      const angle = (index / 35) * Math.PI * 2;
      const distance = 0.15 + (index % 3) * 0.08;
      return {
        lat: koramangalaBase.lat + Math.sin(angle) * distance,
        lng: koramangalaBase.lng + Math.cos(angle) * distance,
      };
    }
  }

  // ── Clubs ────────────────────────────────────────────────────
  const clubNames = [
    "Bangalore Velocity Riders",
    "Silk City Bikers",
    "Outer Ring Road Warriors",
    "Tech Park Riders Club",
    "Indiranagar Motorcycle Society",
    "Whitefield Adventure Club",
    "Bellandur Cruiser Community",
    "Yeshwanthpur Speed Enthusiasts",
    "Electronic City Riders",
    "Banashankari Touring Club",
    "Marathahalli Bike Brotherhood",
    "Hebbal Lake Weekend Warriors",
    "Koramangala Casual Riders",
    "Jayanagar Club Members",
    "Rajajinagar Motorcycle Circle",
    "Ulsoor Urban Explorers",
    "Langford Road Riders",
    "Varthur Adrenaline Junkies",
    "RT Nagar Bike Lovers",
    "Frazer Town Heritage Riders",
    "Yelahanka Noble Riders",
    "Yeshwantpur Off-Road Club",
    "Sanjaynagar Motorcycle Guild",
    "Vidyaranyapura Adventure Seekers",
    "Singasandra Speedway Club",
    "Nagarbhavi Night Riders",
    "Jalahalli Weekend Waves",
    "Gowdenhalli Touring Society",
    "Dakshineswar Motorcycle Collective",
    "Peenya Industrial Area Riders",
    "Goraguntepalya Casual Commuters",
    "MG Road Thunder Club",
    "Brigade Road Cruiser Gang",
  ];

  const clubs: any[] = [];

  // Create clubs - doubled for more discovery data, especially at Koramangala
  for (let i = 0; i < clubNames.length; i++) {
    // First iteration - original clubs
    const coords = generateBangaloreCoords(i);
    const club = await prisma.club.create({
      data: {
        name: clubNames[i],
        description: `Premier motorcycle and scooter club in Bangalore. Join ${clubNames[i]} for weekly group rides, track events, and social gatherings!`,
        image: pickImage(COVER_URLS, i),
        coverImage: pickImage(COVER_URLS, i + 1),
        gallery: [pickImage(COVER_URLS, i), pickImage(COVER_URLS, i + 2)],
        location: "Bangalore, India",
        latitude: coords.lat,
        longitude: coords.lng,
        establishedAt: new Date(
          Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000,
        ),
        verified: Math.random() > 0.3,
        clubType: [
          "Riding Club",
          "Adventure Club",
          "Sport Club",
          "Casual Community",
        ][Math.floor(Math.random() * 4)],
        isPublic: true,
        memberCount: Math.floor(Math.random() * 50) + 5,
        trophies:
          Math.random() > 0.5 ? ["Best Turnout 2025", "Most Active"] : [],
        trophyCount:
          Math.random() > 0.5 ? Math.floor(Math.random() * 3) + 1 : 0,
        reputation: 3.5 + Math.random() * 1.5,
        ownerId: allUsers[Math.floor(Math.random() * allUsers.length)].id,
      },
    });
    clubs.push(club);
  }

  // Second pass: distribute extra club chapters across other Indian metros so
  // users outside Bangalore also see nearby results when their GPS resolves.
  const otherCityCycle: (keyof typeof CITY_CENTERS)[] = [
    "Delhi",
    "Mumbai",
    "Pune",
    "Chennai",
    "Hyderabad",
    "Kochi",
    "Jaipur",
  ];
  for (let i = 0; i < clubNames.length; i++) {
    const city = otherCityCycle[i % otherCityCycle.length];
    const coords = coordsNear(city, i);
    const club = await prisma.club.create({
      data: {
        name: `${clubNames[i]} - ${city} Chapter`,
        description: `${city} chapter of ${clubNames[i]}. Join for rides, meetups, and community events!`,
        image: pickImage(COVER_URLS, i + 3),
        coverImage: pickImage(COVER_URLS, i + 4),
        gallery: [pickImage(COVER_URLS, i + 3), pickImage(COVER_URLS, i + 5)],
        location: `${city}, India`,
        latitude: coords.lat,
        longitude: coords.lng,
        establishedAt: new Date(
          Date.now() - Math.random() * 180 * 24 * 60 * 60 * 1000,
        ),
        verified: Math.random() > 0.4,
        clubType: [
          "Riding Club",
          "Adventure Club",
          "Sport Club",
          "Casual Community",
        ][Math.floor(Math.random() * 4)],
        isPublic: true,
        memberCount: Math.floor(Math.random() * 40) + 8,
        trophies: Math.random() > 0.6 ? ["Local Favorite"] : [],
        trophyCount: Math.random() > 0.6 ? 1 : 0,
        reputation: 3.2 + Math.random() * 1.6,
        ownerId: allUsers[Math.floor(Math.random() * allUsers.length)].id,
      },
    });
    clubs.push(club);
  }

  console.log(`✅ Created ${clubs.length} clubs`);

  // Club members
  const clubMemberMap = new Map<string, any>();
  for (const club of clubs) {
    clubMemberMap.set(`${club.id}:${club.ownerId}`, {
      clubId: club.id,
      userId: club.ownerId,
      role: "FOUNDER",
    });
    for (let j = 0; j < Math.floor(Math.random() * 6) + 2; j++) {
      const userId = allUsers[Math.floor(Math.random() * allUsers.length)].id;
      const key = `${club.id}:${userId}`;
      if (!clubMemberMap.has(key)) {
        clubMemberMap.set(key, {
          clubId: club.id,
          userId,
          role: ["MEMBER", "OFFICER", "ADMIN"][Math.floor(Math.random() * 3)],
        });
      }
    }
  }
  await prisma.clubMember.createMany({
    data: Array.from(clubMemberMap.values()),
  });
  console.log(`✅ Created ${clubMemberMap.size} club memberships`);

  // ── Rides ────────────────────────────────────────────────────
  const rideNames = [
    "Nandi Hills Sunrise Expedition",
    "Ring Road Night Cruise",
    "Electronic City Tech Park Ride",
    "Old Airport Road Speed Run",
    "Sarjapur Road Scenic Tour",
    "Whitefield Tech Campus Commute",
    "Bannerghatta Nature Reserve Ride",
    "Tumkur Road Long Distance",
    "Mysore Road Highway Dash",
    "Bangalore Fort Historical Tour",
    "Vidhana Soudha City Exploration",
    "Cubbon Park Casual Cruise",
    "Indiranagar Lake Weekend Ride",
    "Bellandur Lake Evening Tour",
    "Yeshwanthpur Industrial Loop",
    "Marathahalli Bridge Challenge",
    "Koramangala Nightlife Run",
    "Jayanagar Group Meetup Ride",
    "RT Nagar Community Cruise",
    "Rajajinagar Breakfast Ride",
    "Ulsoor Urban Adventure",
    "Langford Road Vintage Tour",
    "Hebbal Weekend Warriors Ride",
    "Varthur Adrenaline Rush",
    "Frazer Town Heritage Cruise",
    "Yelahanka Off-Road Trail",
    "Sanjaynagar Motorcycle Meetup",
    "Vidyaranyapura Adventure Trek",
    "Singasandra Desert Road Blast",
    "Nagarbhavi Night Exploration",
    "Jalahalli Weekend Waves",
    "Goraguntepalya Cross-City Ride",
    "Dakshineswar Mountain Twisties",
    "MG Road Express Rally",
    "Brigade Road Night Circuit",
  ];

  const rideLocations = [
    "Nandi Hills",
    "Electronic City",
    "Whitefield",
    "Sarjapur",
    "Old Airport Road",
    "Bannerghatta",
    "Tumkur",
    "Mysore Road",
    "Bangalore Fort",
    "Cubbon Park",
    "Indiranagar",
    "Bellandur",
    "Yeshwanthpur",
    "Marathahalli",
    "Koramangala",
    "Jayanagar",
    "RT Nagar",
    "Rajajinagar",
    "Ulsoor",
    "Langford Road",
    "Hebbal",
    "Varthur",
    "Frazer Town",
    "Yelahanka",
    "Sanjaynagar",
    "Vidyaranyapura",
    "Singasandra",
    "Nagarbhavi",
    "Jalahalli",
    "Goraguntepalya",
    "Dakshineswar",
    "Peenya",
    "Gowdenhalli",
    "MG Road",
    "Brigade Road",
  ];

  const rides: any[] = [];
  for (let i = 0; i < rideNames.length; i++) {
    const coords = generateBangaloreCoords(i);
    const expLevels = ["Beginner", "Intermediate", "Expert"];
    const paces = ["Leisurely", "Moderate", "Fast"];
    const statuses = [
      "PLANNED",
      "PLANNED",
      "PLANNED",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
    ] as const;

    const endCoords = generateBangaloreCoords(i + 17);
    const ride = await prisma.ride.create({
      data: {
        title: rideNames[i],
        description: `${rideNames[i]} - A premium experience for motorcycle enthusiasts. Join our community for an unforgettable riding adventure!`,
        images: [pickImage(COVER_URLS, i)],
        startLocation: rideLocations[i],
        endLocation: rideLocations[(i + 1) % rideLocations.length],
        latitude: coords.lat,
        longitude: coords.lng,
        startLat: coords.lat,
        startLng: coords.lng,
        endLat: endCoords.lat,
        endLng: endCoords.lng,
        experienceLevel: expLevels[Math.floor(Math.random() * 3)],
        xpRequired: Math.floor(Math.random() * 1000) + 100,
        pace: paces[Math.floor(Math.random() * 3)],
        distance: Math.floor(Math.random() * 150) + 20,
        duration: Math.floor(Math.random() * 240) + 60,
        scheduledAt: new Date(
          Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        status: statuses[Math.floor(Math.random() * statuses.length)],
        isFeatured: Math.random() > 0.85,
        creatorId: allUsers[Math.floor(Math.random() * allUsers.length)].id,
        clubId: clubs[Math.floor(Math.random() * clubs.length)].id,
      },
    });
    rides.push(ride);
  }

  // Second pass: distribute rides across other metros so non-Bangalore users
  // see nearby rides when their GPS resolves outside Bangalore.
  const rideCityCycle: (keyof typeof CITY_CENTERS)[] = [
    "Delhi",
    "Mumbai",
    "Pune",
    "Chennai",
    "Hyderabad",
    "Kochi",
    "Jaipur",
  ];
  for (let i = 0; i < rideNames.length; i++) {
    const city = rideCityCycle[i % rideCityCycle.length];
    const coords = coordsNear(city, i);
    const expLevels = ["Beginner", "Intermediate", "Expert"];
    const paces = ["Leisurely", "Moderate", "Fast"];
    const statuses = [
      "PLANNED",
      "PLANNED",
      "PLANNED",
      "IN_PROGRESS",
      "COMPLETED",
    ] as const;

    const endCoords = coordsNear(city, i + 17);
    const ride = await prisma.ride.create({
      data: {
        title: `${rideNames[i]} - ${city}`,
        description: `${rideNames[i]} based in ${city}. Experience the best riding routes with fellow enthusiasts in ${city}.`,
        images: [pickImage(COVER_URLS, i + 5)],
        startLocation: `${city} Meetup Point`,
        endLocation: `${city} Outskirts`,
        latitude: coords.lat,
        longitude: coords.lng,
        startLat: coords.lat,
        startLng: coords.lng,
        endLat: endCoords.lat,
        endLng: endCoords.lng,
        experienceLevel: expLevels[Math.floor(Math.random() * 3)],
        xpRequired: Math.floor(Math.random() * 800) + 50,
        pace: paces[Math.floor(Math.random() * 3)],
        distance: Math.floor(Math.random() * 120) + 15,
        duration: Math.floor(Math.random() * 180) + 45,
        scheduledAt: new Date(
          Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        status: statuses[Math.floor(Math.random() * statuses.length)],
        isFeatured: Math.random() > 0.9,
        creatorId: allUsers[Math.floor(Math.random() * allUsers.length)].id,
        clubId: clubs[Math.floor(Math.random() * clubs.length)].id,
      },
    });
    rides.push(ride);
  }

  console.log(`✅ Created ${rides.length} rides`);

  // Ride participants
  const participantMap = new Map<string, any>();
  for (const ride of rides) {
    for (let j = 0; j < Math.floor(Math.random() * 8) + 2; j++) {
      const userId = allUsers[Math.floor(Math.random() * allUsers.length)].id;
      const key = `${ride.id}:${userId}`;
      if (!participantMap.has(key)) {
        participantMap.set(key, {
          rideId: ride.id,
          userId,
          status: ["REQUESTED", "ACCEPTED", "ACCEPTED", "ACCEPTED"][
            Math.floor(Math.random() * 4)
          ],
        });
      }
    }
  }
  await prisma.rideParticipant.createMany({
    data: Array.from(participantMap.values()),
  });
  console.log(`✅ Created ${participantMap.size} ride participants`);

  // Ride tracking summaries for completed/in-progress rides
  const trackableRides = rides
    .filter((r) => r.status === "COMPLETED" || r.status === "IN_PROGRESS")
    .slice(0, 36);

  await prisma.rideTrackingData.createMany({
    data: trackableRides.map((r, i) => ({
      rideId: r.id,
      actualStartTime: new Date(Date.now() - (i + 2) * 60 * 60 * 1000),
      actualEndTime:
        r.status === "COMPLETED"
          ? new Date(Date.now() - i * 15 * 60 * 1000)
          : null,
      totalDurationMin: 45 + (i % 5) * 20,
      totalDistanceKm: 22 + (i % 7) * 11,
      maxSpeedKmh: 68 + (i % 6) * 8,
      avgSpeedKmh: 36 + (i % 5) * 5,
      elevationGainM: 120 + (i % 4) * 55,
      breakCount: i % 3,
      totalBreakMin: (i % 3) * 7,
      weatherNotes: ["clear", "humid", "cloudy", "light drizzle"][i % 4],
      conditions: ["clear", "wet", "mixed", "gravel"][i % 4],
    })),
  });
  console.log(`✅ Created ${trackableRides.length} ride tracking summaries`);

  // Post-ride ratings
  const rideRatingRows: any[] = [];
  const ratingSeen = new Set<string>();
  const acceptedParticipants = Array.from(participantMap.values()).filter(
    (p) => p.status === "ACCEPTED",
  );

  for (const p of acceptedParticipants.slice(0, 140)) {
    const ride = rides.find((r) => r.id === p.rideId);
    if (!ride || ride.creatorId === p.userId) continue;
    const key = `${p.rideId}:${ride.creatorId}:${p.userId}`;
    if (ratingSeen.has(key)) continue;
    ratingSeen.add(key);
    rideRatingRows.push({
      rideId: p.rideId,
      ratedById: ride.creatorId,
      ratedUserId: p.userId,
      rating: 3 + (rideRatingRows.length % 3),
      comment: "Solid rider, good lane discipline and communication.",
      tags: ["Safe", "Friendly"],
    });
  }

  if (rideRatingRows.length) {
    await prisma.rideRating.createMany({ data: rideRatingRows });
  }
  console.log(`✅ Created ${rideRatingRows.length} ride ratings`);

  // ── Marketplace Listings ─────────────────────────────────────
  const listingNames = [
    "AGV K3 SV Full Face Helmet - Size L",
    "Alpinestars Racing Jacket - Medium",
    "Alpinestars Leather Gloves",
    "SIDI Racing Boots - Size 42",
    "Dainese Body Armor Set",
    "Royal Enfield Classic 350 - 2019",
    "Yamaha R15 V4 - 2023",
    "KTM Duke 200 - 2021",
    "Harley Davidson Street 750",
    "Hero Honda Splendor Plus",
    "GoPro Hero 10 with Mounts",
    "DJI Mini 3 Pro Drone",
    "Garmin Zumo 396 GPS",
    "Phone Mount Handlebar Bracket",
    "LED Fog Lights Set",
    "Michelin Road 6 Tyres - Pair",
    "Pirelli Diablo Motorcycle Tyres",
    "Akrapovic Titanium Exhaust",
    "Performance Air Filter Kit",
    "Carbon Fiber Hugger Guard",
    "Motorcycle Chain Lubricant",
    "OEM Engine Oil 4L",
    "Motorcycle Battery YTZ7S",
    "Riding Jacket Winter Edition",
    "Cross Country Gear Set",
    "Daily Commute Backpack",
    "Motorcycle Tool Kit Professional",
    "Portable Air Pump 12V",
    "Secure Cable Lock 2M",
    "Reflective Safety Vest",
    "Motorcycle Phone Charger",
    "Handlebar Mirrors Pair",
    "Tail Tidy Kit Universal",
  ];

  const categories = [
    { cat: "Gear", sub: "Helmet" },
    { cat: "Gear", sub: "Jacket" },
    { cat: "Gear", sub: "Gloves" },
    { cat: "Gear", sub: "Boots" },
    { cat: "Gear", sub: "Armor" },
    { cat: "Motorcycle", sub: "Street" },
    { cat: "Motorcycle", sub: "Sport" },
    { cat: "Motorcycle", sub: "Cruiser" },
    { cat: "Motorcycle", sub: "Scooter" },
    { cat: "Motorcycle", sub: "Commuter" },
    { cat: "Accessories", sub: "Camera" },
    { cat: "Accessories", sub: "Drone" },
    { cat: "Accessories", sub: "GPS" },
    { cat: "Accessories", sub: "Mount" },
    { cat: "Accessories", sub: "Lights" },
    { cat: "Parts", sub: "Tyres" },
    { cat: "Parts", sub: "Exhaust" },
    { cat: "Parts", sub: "Filters" },
    { cat: "Parts", sub: "Guards" },
    { cat: "Parts", sub: "Oil" },
    { cat: "Parts", sub: "Battery" },
    { cat: "Gear", sub: "Protective" },
    { cat: "Gear", sub: "Winter" },
    { cat: "Accessories", sub: "Luggage" },
    { cat: "Accessories", sub: "Tools" },
    { cat: "Accessories", sub: "Pump" },
    { cat: "Accessories", sub: "Lock" },
    { cat: "Accessories", sub: "Safety" },
    { cat: "Accessories", sub: "Charger" },
    { cat: "Accessories", sub: "Mirror" },
    { cat: "Gear", sub: "Adventure" },
    { cat: "Accessories", sub: "Backpack" },
    { cat: "Parts", sub: "Tail Tidy" },
  ];

  const listings: any[] = [];
  const prices = [
    2000, 3500, 5000, 8500, 12000, 15000, 25000, 28000, 125000, 250000,
  ];
  const conditions = ["New", "Like New", "Good", "Fair"];
  for (let i = 0; i < listingNames.length; i++) {
    const coords = generateBangaloreCoords(i);
    const subcategory = categories[i % categories.length].sub;
    const listing = await prisma.marketplaceListing.create({
      data: {
        title: listingNames[i],
        description: `${listingNames[i]} - Premium quality, verified seller. Contact for details.`,
        price: prices[Math.floor(Math.random() * prices.length)],
        currency: "INR",
        category: categories[i % categories.length].cat,
        subcategory,
        condition: conditions[Math.floor(Math.random() * conditions.length)],
        images: listingImagesFor(subcategory, i),
        status:
          Math.random() > 0.15 ? ListingStatus.ACTIVE : ListingStatus.SOLD,
        latitude: coords.lat,
        longitude: coords.lng,
        sellerId: allUsers[Math.floor(Math.random() * allUsers.length)].id,
      },
    });
    listings.push(listing);
  }
  console.log(`✅ Created ${listings.length} marketplace listings`);

  // Listing interests + offers (new marketplace negotiation models)
  const listingInterestsData: any[] = [];
  const listingOffersData: any[] = [];
  const interestSeen = new Set<string>();

  for (const listing of listings.slice(0, 28)) {
    const interestedCount = Math.floor(Math.random() * 3) + 1;
    for (let j = 0; j < interestedCount; j++) {
      const interestedUser =
        allUsers[Math.floor(Math.random() * allUsers.length)];
      if (interestedUser.id === listing.sellerId) continue;

      const key = `${listing.id}:${interestedUser.id}`;
      if (interestSeen.has(key)) continue;
      interestSeen.add(key);

      listingInterestsData.push({
        listingId: listing.id,
        userId: interestedUser.id,
      });

      listingOffersData.push({
        listingId: listing.id,
        buyerId: interestedUser.id,
        status: [
          ListingOfferStatus.INTERESTED,
          ListingOfferStatus.OFFER_MADE,
          ListingOfferStatus.NEGOTIATING,
        ][Math.floor(Math.random() * 3)],
        originalPrice: listing.price,
        offeredPrice: Math.max(500, Math.round(listing.price * 0.92)),
        message: "Interested in this item. Open to quick meetup this week.",
        lastMessageAt: new Date(),
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });
    }
  }

  if (listingInterestsData.length) {
    await prisma.listingInterest.createMany({
      data: listingInterestsData,
      skipDuplicates: true,
    });
  }

  if (listingOffersData.length) {
    await prisma.listingOffer.createMany({
      data: listingOffersData,
      skipDuplicates: true,
    });
  }

  console.log(
    `✅ Created ${listingInterestsData.length} listing interests and ${listingOffersData.length} listing offers`,
  );

  // ── Posts ─────────────────────────────────────────────────────
  const posts: any[] = [];
  const postContents = [
    "Just completed an amazing sunrise ride! 🌅🏍️",
    "Who's joining this weekend?",
    "Selling my gear - check out the listing!",
    "Best track day ever! 🏁",
    "New bike day! Couldn't resist 🔥",
    "Safety check done, ready to roll!",
    "Exploring new routes around Bangalore",
    "Night ride vibes are unmatched 🌙",
    "Group ride photos coming soon!",
    "Anyone knows a good mechanic in Koramangala?",
    "Monsoon riding tips - thread below 🧵",
    "Just hit 10000 km milestone!",
  ];
  for (let i = 0; i < 25; i++) {
    // 1–2 images per post, skip some posts for text-only variety
    const images =
      i % 4 === 3
        ? []
        : i % 3 === 0
          ? [pickImage(POST_IMAGES, i), pickImage(POST_IMAGES, i + 1)]
          : [pickImage(POST_IMAGES, i)];
    const post = await prisma.post.create({
      data: {
        type: i < 10 ? "ride" : i < 20 ? "content" : "listing",
        content: postContents[i % postContents.length],
        images,
        authorId: allUsers[i % allUsers.length].id,
        rideId: i < 10 ? rides[i % rides.length].id : undefined,
        listingId: i >= 20 ? listings[i % listings.length].id : undefined,
      },
    });
    posts.push(post);
  }
  console.log(`✅ Created ${posts.length} posts`);

  // ── Likes ────────────────────────────────────────────────────
  const likeMap = new Map<string, any>();
  for (const post of posts) {
    for (let j = 0; j < Math.floor(Math.random() * 6) + 1; j++) {
      const userId = allUsers[Math.floor(Math.random() * allUsers.length)].id;
      const key = `${post.id}:${userId}`;
      if (!likeMap.has(key)) likeMap.set(key, { postId: post.id, userId });
    }
  }
  await prisma.like.createMany({ data: Array.from(likeMap.values()) });
  console.log(`✅ Created ${likeMap.size} likes`);

  // ── Comments ─────────────────────────────────────────────────
  const commentTexts = [
    "Amazing! Count me in! 🔥",
    "This looks incredible!",
    "Can't wait! See you there!",
    "Perfect for my skill level!",
    "Is this beginner friendly?",
    "Already signed up! 💪",
    "Love riding with this crew!",
    "Great deal! Still available?",
    "Excellent condition! Interested!",
    "Would you consider trading?",
  ];
  const commentsData: any[] = [];
  for (const post of posts) {
    for (let j = 0; j < Math.floor(Math.random() * 4); j++) {
      commentsData.push({
        postId: post.id,
        authorId: allUsers[Math.floor(Math.random() * allUsers.length)].id,
        content: commentTexts[Math.floor(Math.random() * commentTexts.length)],
      });
    }
  }
  await prisma.comment.createMany({ data: commentsData });
  console.log(`✅ Created ${commentsData.length} comments`);

  // ── Reviews ──────────────────────────────────────────────────
  const reviewTexts = [
    "Excellent seller, fast and reliable!",
    "Great quality, as described!",
    "Highly recommended!",
    "Good condition, exactly needed!",
    "Very responsive seller!",
    "Authentic product, satisfied!",
  ];
  const reviewSet = new Set<string>();
  const reviewsData: any[] = [];
  for (let i = 0; i < Math.min(listings.length, 20); i++) {
    for (let j = 0; j < Math.floor(Math.random() * 3) + 1; j++) {
      const userId = allUsers[Math.floor(Math.random() * allUsers.length)].id;
      const key = `${listings[i].id}:${userId}`;
      if (userId !== listings[i].sellerId && !reviewSet.has(key)) {
        reviewSet.add(key);
        reviewsData.push({
          listingId: listings[i].id,
          reviewerId: userId,
          rating: Math.floor(Math.random() * 2) + 4,
          comment: reviewTexts[Math.floor(Math.random() * reviewTexts.length)],
        });
      }
    }
  }
  await prisma.review.createMany({ data: reviewsData });
  console.log(`✅ Created ${reviewsData.length} reviews`);

  // ── Reports ──────────────────────────────────────────────────
  const reportData = [
    {
      type: "user",
      title: "Spam account",
      description: "This user keeps spamming the feed",
      reportedItemId: user4.id,
      reportedItemName: user4.name,
      reportedItemType: "user",
      reporterId: user1.id,
      status: "pending",
      priority: "medium",
    },
    {
      type: "listing",
      title: "Suspicious listing",
      description: "Price too good to be true",
      reportedItemId: listings[0]?.id,
      reportedItemName: listings[0]?.title,
      reportedItemType: "listing",
      reporterId: user2.id,
      status: "pending",
      priority: "high",
    },
    {
      type: "user",
      title: "Inappropriate bio",
      description: "User has offensive content",
      reportedItemId: user8.id,
      reportedItemName: user8.name,
      reportedItemType: "user",
      reporterId: user3.id,
      status: "reviewing",
      priority: "medium",
    },
    {
      type: "listing",
      title: "Counterfeit product",
      description: "Fake branded item",
      reportedItemId: listings[2]?.id,
      reportedItemName: listings[2]?.title,
      reportedItemType: "listing",
      reporterId: user5.id,
      status: "pending",
      priority: "high",
    },
    {
      type: "club",
      title: "Inactive club",
      description: "Club has no activity for months",
      reportedItemId: clubs[5]?.id,
      reportedItemName: clubs[5]?.name,
      reportedItemType: "club",
      reporterId: user7.id,
      status: "resolved",
      priority: "low",
    },
  ];
  await prisma.report.createMany({ data: reportData });
  console.log(`✅ Created ${reportData.length} reports`);

  // ── Events + Attendees ─────────────────────────────────────────
  const eventRows: any[] = [];
  const eventCount = Math.min(18, clubs.length);
  for (let i = 0; i < eventCount; i++) {
    const club = clubs[i];
    const event = await prisma.event.create({
      data: {
        title: `${club.name} Community Ride Meetup`,
        description:
          "Hosted community event with briefing, short ride, and hangout.",
        location: club.location || "Bangalore, India",
        latitude: club.latitude,
        longitude: club.longitude,
        scheduledAt: new Date(Date.now() + (i + 2) * 24 * 60 * 60 * 1000),
        status: EventStatus.PLANNED,
        isFeatured: i < 4,
        creatorId: club.ownerId,
        clubId: club.id,
      },
    });
    eventRows.push(event);
  }

  const eventParticipantRows: any[] = [];
  const eventParticipantSeen = new Set<string>();
  for (const event of eventRows) {
    const participantCount = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < participantCount; i++) {
      const userId = allUsers[Math.floor(Math.random() * allUsers.length)].id;
      const key = `${event.id}:${userId}`;
      if (eventParticipantSeen.has(key)) continue;
      eventParticipantSeen.add(key);
      eventParticipantRows.push({
        eventId: event.id,
        userId,
        status: "ACCEPTED",
      });
    }
  }

  if (eventParticipantRows.length) {
    await prisma.eventParticipant.createMany({
      data: eventParticipantRows,
      skipDuplicates: true,
    });
  }
  console.log(
    `✅ Created ${eventRows.length} events with ${eventParticipantRows.length} attendees`,
  );

  // ── Notifications ─────────────────────────────────────────────
  const notificationsData = allUsers.flatMap((u, i) => [
    {
      userId: u.id,
      type: NotificationType.RIDE_INVITE,
      title: "New ride invite",
      message: "You were invited to a group ride this weekend.",
      relatedType: "ride",
      relatedId: rides[i % rides.length]?.id,
      isRead: i % 3 === 0,
      sentViaPush: true,
      sentViaEmail: false,
    },
    {
      userId: u.id,
      type: NotificationType.LISTING_OFFER,
      title: "New offer on your listing",
      message: "A buyer placed an offer on one of your items.",
      relatedType: "listing",
      relatedId: listings[i % listings.length]?.id,
      isRead: false,
      sentViaPush: true,
      sentViaEmail: i % 2 === 0,
    },
  ]);

  await prisma.notification.createMany({ data: notificationsData });
  console.log(`✅ Created ${notificationsData.length} notifications`);

  // ── Friend Groups (Squads) ───────────────────────────────────
  const friendGroups = [
    {
      name: "Weekend Warriors",
      description: "Early morning weekend rides around Bangalore",
      creatorId: adminUser.id,
      members: [adminUser.id, user1.id, user2.id, user3.id, user5.id],
    },
    {
      name: "Night Riders Crew",
      description: "Late night cruises through the city",
      creatorId: user1.id,
      members: [user1.id, user2.id, user4.id, user8.id],
    },
    {
      name: "Highway Hoolz",
      description: "Long distance highway runs every fortnight",
      creatorId: user2.id,
      members: [user2.id, adminUser.id, user3.id, user4.id, user6.id, user7.id],
    },
    {
      name: "Coffee Run Squad",
      description: "Short rides to the best cafés in town",
      creatorId: user3.id,
      members: [user3.id, user1.id, user4.id, user6.id],
    },
    {
      name: "Nandi Hills Gang",
      description: "Weekly sunrise rides to Nandi Hills",
      creatorId: user5.id,
      members: [user5.id, adminUser.id, user1.id, user2.id, user3.id, user9.id],
    },
    {
      name: "Track Day Addicts",
      description: "Track practice at MMRT & Kari Motor Speedway",
      creatorId: user7.id,
      members: [user7.id, user2.id, user9.id],
    },
    {
      name: "Vintage Collectors",
      description: "Classic and vintage motorcycle enthusiasts",
      creatorId: user9.id,
      members: [user9.id, user3.id, user5.id, user7.id],
    },
    {
      name: "Offroad Tribe",
      description: "Dirt trails and offroad adventures",
      creatorId: user7.id,
      members: [user7.id, user3.id, user5.id, adminUser.id, user8.id],
    },
  ];

  const createdFriendGroups: any[] = [];

  for (const fg of friendGroups) {
    const group = await prisma.friendGroup.create({
      data: {
        name: fg.name,
        description: fg.description,
        creatorId: fg.creatorId,
      },
    });
    createdFriendGroups.push(group);
    await prisma.friendGroupMember.createMany({
      data: fg.members.map((userId) => ({ groupId: group.id, userId })),
    });
  }
  console.log(`✅ Created ${friendGroups.length} friend groups`);

  // ── Chat (MongoDB conversations + messages) ───────────────────
  const mongo = await connectMongoDB();
  if (!mongo) {
    console.warn(
      "⚠️  MongoDB not available, skipping chat conversation/message seed",
    );
  } else {
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    await UnreadCount.deleteMany({});

    const seedConversation = async (params: {
      type: ConversationType;
      participantIds: string[];
      createdBy: string;
      relatedEntityId?: string;
      metadata?: {
        name?: string;
        avatar?: string;
        description?: string;
      };
      messages: Array<{ senderId: string; text: string }>;
    }) => {
      const participantIds = Array.from(new Set(params.participantIds));
      const conversation = await Conversation.create({
        type: params.type,
        participants: participantIds.map((userId) => ({
          userId,
          role:
            userId === params.createdBy
              ? ParticipantRole.OWNER
              : ParticipantRole.MEMBER,
          joinedAt: new Date(),
          isMuted: false,
        })),
        relatedEntityId: params.relatedEntityId || null,
        metadata: params.metadata || {},
        createdBy: params.createdBy,
        isActive: true,
      });

      let latestMessage: any = null;

      for (const msg of params.messages) {
        latestMessage = await Message.create({
          conversationId: conversation._id,
          senderId: msg.senderId,
          text: msg.text,
          messageType: MessageType.TEXT,
          attachments: [],
          readBy: [{ userId: msg.senderId, readAt: new Date() }],
          deliveredTo: participantIds.map((userId) => ({
            userId,
            deliveredAt: new Date(),
          })),
        });
      }

      if (latestMessage) {
        await Conversation.updateOne(
          { _id: conversation._id },
          {
            $set: {
              lastMessage: {
                text: latestMessage.text || "Message",
                senderId: latestMessage.senderId,
                senderName:
                  allUsers.find((u) => u.id === latestMessage.senderId)?.name ||
                  "Rider",
                sentAt: latestMessage.createdAt,
                messageType: MessageType.TEXT,
              },
              updatedAt: latestMessage.createdAt,
            },
          },
        );

        const unreadRows = participantIds
          .filter((userId) => userId !== latestMessage.senderId)
          .map((userId) => ({
            userId,
            conversationId: conversation._id,
            count: 1,
            lastReadAt: null,
          }));

        if (unreadRows.length) {
          await UnreadCount.insertMany(unreadRows);
        }
      }
    };

    const directParticipants = [adminUser.id, user1.id];
    const firstListing =
      listings.find((l) => l.sellerId !== user2.id) || listings[0];
    const marketplaceBuyer =
      allUsers.find((u) => u.id !== firstListing.sellerId) || user2;

    const clubParticipants = Array.from(clubMemberMap.values())
      .filter((m) => m.clubId === clubs[0].id)
      .slice(0, 5)
      .map((m) => m.userId);

    const rideParticipants = Array.from(participantMap.values())
      .filter((p) => p.rideId === rides[0].id)
      .slice(0, 5)
      .map((p) => p.userId);

    await seedConversation({
      type: ConversationType.DIRECT,
      participantIds: directParticipants,
      createdBy: adminUser.id,
      metadata: {
        description: "General rider-to-rider chat",
      },
      messages: [
        {
          senderId: adminUser.id,
          text: "Hey John, up for a sunrise spin this weekend?",
        },
        {
          senderId: user1.id,
          text: "Absolutely. Let us do Nandi Hills and grab breakfast after!",
        },
      ],
    });

    await seedConversation({
      type: ConversationType.MARKETPLACE,
      participantIds: [firstListing.sellerId, marketplaceBuyer.id],
      createdBy: marketplaceBuyer.id,
      relatedEntityId: firstListing.id,
      metadata: {
        name: `About: ${firstListing.title}`,
        description: "Buy/sell discussion for marketplace listing",
      },
      messages: [
        {
          senderId: marketplaceBuyer.id,
          text: "Hi! Is this still available?",
        },
        {
          senderId: firstListing.sellerId,
          text: "Yes, it is available. I can share more photos if needed.",
        },
        {
          senderId: marketplaceBuyer.id,
          text: "Great, can we do a quick meetup tomorrow evening?",
        },
      ],
    });

    await seedConversation({
      type: ConversationType.CLUB,
      participantIds:
        clubParticipants.length >= 2
          ? clubParticipants
          : [clubs[0].ownerId, user3.id, user4.id],
      createdBy: clubs[0].ownerId,
      relatedEntityId: createdFriendGroups[0]?.id || clubs[0].id,
      metadata: {
        name: `${createdFriendGroups[0]?.name || clubs[0].name} Squad Chat`,
        description: "Group/squad coordination chat",
      },
      messages: [
        {
          senderId: clubs[0].ownerId,
          text: "Squad check-in: rolling out at 6:00 AM sharp.",
        },
        {
          senderId:
            clubParticipants.find((id) => id !== clubs[0].ownerId) || user3.id,
          text: "Copy that. Fuel and tyre pressure done.",
        },
      ],
    });

    const rideCreator = rides[0].creatorId;
    const seededRideParticipants = Array.from(
      new Set([rideCreator, ...rideParticipants]),
    );

    await seedConversation({
      type: ConversationType.RIDE,
      participantIds:
        seededRideParticipants.length >= 2
          ? seededRideParticipants
          : [rideCreator, user5.id, user6.id],
      createdBy: rideCreator,
      relatedEntityId: rides[0].id,
      metadata: {
        name: `${rides[0].title} Ride Chat`,
        description: "Live route and meetup updates",
      },
      messages: [
        {
          senderId: rideCreator,
          text: "Meetup point moved to Shell near the flyover.",
        },
        {
          senderId:
            seededRideParticipants.find((id) => id !== rideCreator) || user6.id,
          text: "On my way, ETA 12 minutes.",
        },
      ],
    });

    console.log("✅ Seeded Mongo chat conversations and messages");
  }

  // ══════════════════════════════════════════════════════════════════
  //  BRANDS & BRAND PRODUCTS
  // ══════════════════════════════════════════════════════════════════

  const BRAND_LOGO_URLS = [
    "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200",
    "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=200",
    "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=200",
    "https://images.unsplash.com/photo-1609630875171-b1321377ee65?w=200",
    "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=200",
    "https://images.unsplash.com/photo-1520975916090-3105956dac38?w=200",
  ];

  const BRAND_BANNER_URLS = [
    "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200",
    "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=1200",
    "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=1200",
    "https://images.unsplash.com/photo-1511994298241-608e28f14fde?w=1200",
    "https://images.unsplash.com/photo-1580310614729-ccd69652491d?w=1200",
    "https://images.unsplash.com/photo-1449426468159-d96dbf08f19f?w=1200",
  ];

  type BrandDef = {
    name: string; slug: string; email: string; username: string; tagline: string;
    description: string; city: string; cityKey: keyof typeof CITY_CENTERS;
    categories: string[]; products: Array<{ title: string; price: number; cat: string; sub: string }>;
  };

  const BRANDS: BrandDef[] = [
    {
      name: "ThunderGear Co.",
      slug: "thundergear-co",
      email: "brand1@thundergear.com",
      username: "thundergear",
      tagline: "Built for the road, built for speed",
      description: "India's premier motorcycle gear brand. From helmets to jackets, we craft riding gear that merges safety with style. Trusted by 50,000+ riders across India.",
      city: "Bangalore",
      cityKey: "Bangalore",
      categories: ["GEAR_SELLER", "HELMET_SELLER"],
      products: [
        { title: "TG Pro Helmet - AGV Style Full Face", price: 8500, cat: "Gear", sub: "Helmet" },
        { title: "TG Carbon Touring Jacket - Black/Orange", price: 12000, cat: "Gear", sub: "Jacket" },
        { title: "TG Street Gloves - Touch Screen Compatible", price: 2200, cat: "Gear", sub: "Gloves" },
        { title: "TG Adventure Boots - Waterproof", price: 6500, cat: "Gear", sub: "Boots" },
        { title: "TG Spine Protector - CE Level 2", price: 3800, cat: "Gear", sub: "Armor" },
        { title: "TG Winter Base Layer Set", price: 1800, cat: "Gear", sub: "Winter" },
        { title: "TG Modular Helmet - Bluetooth Ready", price: 14500, cat: "Gear", sub: "Helmet" },
        { title: "TG Racing Gloves - Track Day Spec", price: 4200, cat: "Gear", sub: "Gloves" },
        { title: "TG Armored Riding Pants - Kevlar", price: 7800, cat: "Gear", sub: "Protective" },
        { title: "TG Ventilated Summer Jacket - Mesh", price: 5500, cat: "Gear", sub: "Jacket" },
        { title: "TG Knee Guards - Trail Pack", price: 1600, cat: "Gear", sub: "Guards" },
        { title: "TG Neck Brace - Carbon Composite", price: 9800, cat: "Gear", sub: "Protective" },
      ],
    },
    {
      name: "Moto Parts India",
      slug: "moto-parts-india",
      email: "brand2@motoparts.com",
      username: "motopartsindia",
      tagline: "OEM quality at aftermarket prices",
      description: "Your one-stop shop for genuine and aftermarket motorcycle spares. We stock parts for 200+ bike models. Fast shipping, 12-month warranty on all parts.",
      city: "Mumbai",
      cityKey: "Mumbai",
      categories: ["PARTS_SELLER"],
      products: [
        { title: "Michelin Pilot Road 5 Tyre - 120/70", price: 8800, cat: "Parts", sub: "Tyres" },
        { title: "Akrapovic Slip-On Exhaust - Universal", price: 18000, cat: "Parts", sub: "Exhaust" },
        { title: "K&N Air Filter - RE Classic 350", price: 2800, cat: "Parts", sub: "Filters" },
        { title: "Motul 7100 Engine Oil 4L - 10W40", price: 1600, cat: "Parts", sub: "Oil" },
        { title: "Bosch Lithium Battery - 12V 9Ah", price: 3400, cat: "Parts", sub: "Battery" },
        { title: "Excel Rim Tape Set - All Colours", price: 450, cat: "Accessories", sub: "Mirror" },
        { title: "Brembo Front Brake Disc - 320mm", price: 6500, cat: "Parts", sub: "Guards" },
        { title: "Renthal Handlebar - Fatbar 28mm", price: 3200, cat: "Parts", sub: "Guards" },
        { title: "SW Motech Crash Bars - KTM 390", price: 5800, cat: "Accessories", sub: "Guards" },
        { title: "Metzeler Tourance Tyre - 150/70 R17", price: 9200, cat: "Parts", sub: "Tyres" },
        { title: "Rizoma Mirror Set - Round Chrome", price: 4100, cat: "Accessories", sub: "Mirror" },
        { title: "Yoshimura Exhaust - R15 V4 Slip On", price: 12500, cat: "Parts", sub: "Exhaust" },
      ],
    },
    {
      name: "Helmet Hub",
      slug: "helmet-hub",
      email: "brand3@helmethub.in",
      username: "helmethub",
      tagline: "Your head deserves the best",
      description: "Authorized dealers for 15+ global helmet brands including Shoei, Arai, AGV, Bell, and HJC. We also stock affordable Indian brands. All helmets ISI/DOT certified.",
      city: "Delhi",
      cityKey: "Delhi",
      categories: ["HELMET_SELLER"],
      products: [
        { title: "Shoei GT-Air 3 - Bluetooth Ready", price: 38000, cat: "Gear", sub: "Helmet" },
        { title: "AGV K6 S - Full Face Sports", price: 28500, cat: "Gear", sub: "Helmet" },
        { title: "Arai RX-7V Evo - Corsair Black", price: 52000, cat: "Gear", sub: "Helmet" },
        { title: "Bell Race Star Flex - DLX MIPS", price: 22000, cat: "Gear", sub: "Helmet" },
        { title: "HJC i91 Modular - Wireless Music", price: 14500, cat: "Gear", sub: "Helmet" },
        { title: "LS2 FF900 Valiant 2 - Flip Up", price: 9800, cat: "Gear", sub: "Helmet" },
        { title: "Nolan N100-6 - Adventure Helmet", price: 19500, cat: "Gear", sub: "Helmet" },
        { title: "Schuberth C5 - Touring Modular", price: 42000, cat: "Gear", sub: "Helmet" },
        { title: "Caberg Jackal X - Off Road", price: 8200, cat: "Gear", sub: "Helmet" },
        { title: "Ruroc Atlas 4.0 - Carbon Lid", price: 24000, cat: "Gear", sub: "Helmet" },
        { title: "Steelbird Air GT - Dual Visor", price: 3200, cat: "Gear", sub: "Helmet" },
        { title: "Vega Off Road Helmet - Adventure", price: 2800, cat: "Gear", sub: "Helmet" },
      ],
    },
    {
      name: "Ride Ready Store",
      slug: "ride-ready-store",
      email: "brand4@rideready.in",
      username: "ridereadystore",
      tagline: "Everything a rider needs, in one place",
      description: "Multi-brand riding gear and accessories retailer. From entry-level to pro-grade gear. We serve beginner riders all the way to professional racers.",
      city: "Pune",
      cityKey: "Pune",
      categories: ["GEAR_SELLER", "MARKETPLACE_SELLER"],
      products: [
        { title: "Dainese Desert Tex Jacket - Sand", price: 18500, cat: "Gear", sub: "Jacket" },
        { title: "Alpinestars SP8 V3 Air Gloves", price: 6200, cat: "Gear", sub: "Gloves" },
        { title: "REV'IT! Sand 4 Touring Pants", price: 14200, cat: "Gear", sub: "Protective" },
        { title: "Forma ADV Tourer Boot - Black", price: 8800, cat: "Gear", sub: "Boots" },
        { title: "Kriega R25 Backpack - Waterproof", price: 11500, cat: "Accessories", sub: "Backpack" },
        { title: "Oxford Cliqr Phone Mount - Universal", price: 1800, cat: "Accessories", sub: "Mount" },
        { title: "Sena 30K Mesh Intercom - Single", price: 22000, cat: "Accessories", sub: "Camera" },
        { title: "GoPro Hero 12 Moto Kit - Chin Mount", price: 32000, cat: "Accessories", sub: "Camera" },
        { title: "Nelson-Rigg Saddlebag Set - 30L", price: 6800, cat: "Accessories", sub: "Luggage" },
        { title: "Klim Latitude Off-Road Jacket - XL", price: 28000, cat: "Gear", sub: "Jacket" },
        { title: "BMW GS Dry Bag - 10L", price: 4200, cat: "Accessories", sub: "Luggage" },
        { title: "Furygan TD21 EVO Leather Gloves", price: 5600, cat: "Gear", sub: "Gloves" },
      ],
    },
    {
      name: "SpeedWrench Garage",
      slug: "speedwrench-garage",
      email: "brand5@speedwrench.in",
      username: "speedwrench",
      tagline: "Expert mechanics, honest service",
      description: "Multi-brand authorized service centre in Hyderabad. Specializing in RE, KTM, Bajaj, Honda, and Yamaha. Performance tuning and custom builds welcome.",
      city: "Hyderabad",
      cityKey: "Hyderabad",
      categories: ["SERVICE_STORE", "MECHANIC"],
      products: [
        { title: "Full Service Package - 125-200cc", price: 1800, cat: "Parts", sub: "Oil" },
        { title: "Full Service Package - 300-400cc", price: 2800, cat: "Parts", sub: "Oil" },
        { title: "Tyre Change (Tubeless) - Pair", price: 800, cat: "Parts", sub: "Tyres" },
        { title: "Brake Pad Replacement - Front+Rear", price: 1200, cat: "Parts", sub: "Guards" },
        { title: "Chain & Sprocket Kit - RE Classic", price: 3800, cat: "Parts", sub: "Guards" },
        { title: "Performance Tune - KTM Duke/RC", price: 4500, cat: "Parts", sub: "Exhaust" },
        { title: "Suspension Setup - Race Spec", price: 6000, cat: "Parts", sub: "Guards" },
        { title: "Full Wash + Polish Detailing", price: 800, cat: "Accessories", sub: "Tools" },
        { title: "Carburetor Clean + Jet Kit", price: 2200, cat: "Parts", sub: "Filters" },
        { title: "Battery Test + Replacement", price: 3200, cat: "Parts", sub: "Battery" },
        { title: "Exhaust Wrap + Heat Shield Fit", price: 1600, cat: "Parts", sub: "Exhaust" },
        { title: "Fork Oil Change + Seal Kit", price: 2800, cat: "Parts", sub: "Oil" },
      ],
    },
    {
      name: "Road Gear Nation",
      slug: "road-gear-nation",
      email: "brand6@roadgearnation.com",
      username: "roadgearnation",
      tagline: "Indian riders, Indian prices",
      description: "Homegrown Indian gear brand designed specifically for Indian riding conditions — dust, heat, monsoons. Affordable without compromising on safety. Made in India.",
      city: "Chennai",
      cityKey: "Chennai",
      categories: ["BRAND", "GEAR_SELLER"],
      products: [
        { title: "RGN Monsoon Jacket - Waterproof L", price: 4200, cat: "Gear", sub: "Jacket" },
        { title: "RGN Duster Full Face Helmet - Matt", price: 3800, cat: "Gear", sub: "Helmet" },
        { title: "RGN Touring Gloves - Long Cuff", price: 1200, cat: "Gear", sub: "Gloves" },
        { title: "RGN Track Boots - Ankle Support", price: 3200, cat: "Gear", sub: "Boots" },
        { title: "RGN Summer Mesh Jacket - S/M/L/XL", price: 2800, cat: "Gear", sub: "Jacket" },
        { title: "RGN Back Protector Insert - Slim", price: 900, cat: "Gear", sub: "Armor" },
        { title: "RGN Hip Pad Set - CE Level 1", price: 650, cat: "Gear", sub: "Protective" },
        { title: "RGN Rain Suit Over Jacket", price: 1800, cat: "Gear", sub: "Winter" },
        { title: "RGN Reflective Hi-Vis Vest - Night", price: 550, cat: "Gear", sub: "Safety" },
        { title: "RGN Tank Bag - Magnetic 10L", price: 1600, cat: "Accessories", sub: "Luggage" },
        { title: "RGN Knee Slider Set - Street", price: 420, cat: "Gear", sub: "Protective" },
        { title: "RGN Full Suit Combo - Jacket+Pants", price: 7800, cat: "Gear", sub: "Protective" },
      ],
    },
    // ── Koramangala (dev location) ──────────────────────────────────
    {
      name: "Moto Den Koramangala",
      slug: "moto-den-koramangala",
      email: "brand7@motoden.in",
      username: "motoden_koramangala",
      tagline: "Bangalore's favourite gear stop",
      description: "Walk-in gear and accessories store on 80 Feet Road, Koramangala. Stocking helmets, jackets, gloves, and accessories from all major brands. Expert fitment advice, no-pressure sales.",
      city: "Koramangala, Bangalore",
      cityKey: "Koramangala",
      categories: ["GEAR_SELLER", "HELMET_SELLER", "MARKETPLACE_SELLER"],
      products: [
        { title: "MT Helmets Revenge 2 - Solid Gloss", price: 6200, cat: "Gear", sub: "Helmet" },
        { title: "Alpinestars Andes v3 Jacket - Black", price: 14500, cat: "Gear", sub: "Jacket" },
        { title: "Alpinestars SP-8 v3 Gloves - Short", price: 3800, cat: "Gear", sub: "Gloves" },
        { title: "TCX Street ACE Air Boots - Brown", price: 8900, cat: "Gear", sub: "Boots" },
        { title: "Biltwell Gringo S Full Face - Flat", price: 11200, cat: "Gear", sub: "Helmet" },
        { title: "Oxford Layers WB Waterproof Suit", price: 5400, cat: "Gear", sub: "Winter" },
        { title: "Kriega US-10 Drypack Tail Bag", price: 7200, cat: "Accessories", sub: "Luggage" },
        { title: "Oxford Chain Boss Lock 1.5m", price: 2800, cat: "Accessories", sub: "Lock" },
        { title: "Interphone Active Bluetooth Headset", price: 9800, cat: "Accessories", sub: "Charger" },
        { title: "Pyramid Plastics Bar End Mirrors Pair", price: 1200, cat: "Accessories", sub: "Mirror" },
        { title: "Held Air N Dry Gloves - 2-in-1", price: 4600, cat: "Gear", sub: "Gloves" },
        { title: "Shad SH45 Top Box with Universal Fit", price: 6800, cat: "Accessories", sub: "Luggage" },
      ],
    },
    {
      name: "KTech Moto Service",
      slug: "ktech-moto-service",
      email: "brand8@ktech.in",
      username: "ktech_motoservice",
      tagline: "Precision service for modern bikes",
      description: "KTM, RE, Triumph, and Kawasaki specialist workshop in Koramangala. ECU remapping, suspension setup, performance tuning, and factory-grade servicing. Appointment-based for zero wait times.",
      city: "Koramangala, Bangalore",
      cityKey: "Koramangala",
      categories: ["SERVICE_STORE", "MECHANIC"],
      products: [
        { title: "KTM Duke/RC Full Service - 5000km", price: 2800, cat: "Parts", sub: "Oil" },
        { title: "RE Himalayan Complete Service", price: 2200, cat: "Parts", sub: "Oil" },
        { title: "ECU Remap + Dyno Tune Session", price: 6500, cat: "Parts", sub: "Filters" },
        { title: "Suspension Revalve + Spring Rate", price: 8000, cat: "Parts", sub: "Guards" },
        { title: "Pirelli Angel GT2 Tyre - Fitted 180", price: 12500, cat: "Parts", sub: "Tyres" },
        { title: "Akrapovic Slip-On Exhaust - Fitted", price: 24000, cat: "Parts", sub: "Exhaust" },
        { title: "Battery Replacement + Load Test", price: 2400, cat: "Parts", sub: "Battery" },
        { title: "Brake Fluid Flush + Bleed Service", price: 800, cat: "Parts", sub: "Filters" },
        { title: "Chain + Sprocket Kit - Fitted", price: 3800, cat: "Parts", sub: "Tyres" },
        { title: "Windscreen Installation + Sealing", price: 1200, cat: "Parts", sub: "Guards" },
      ],
    },
    {
      name: "Racer's Pit Bangalore",
      slug: "racers-pit-bangalore",
      email: "brand9@racerspit.in",
      username: "racerspit_blr",
      tagline: "Track-tested. Road-proven.",
      description: "Performance parts and track-day accessories for serious riders. Bangalore's only dedicated performance moto shop. From crash protection to data loggers — if it makes you faster or safer, we stock it.",
      city: "Koramangala, Bangalore",
      cityKey: "Koramangala",
      categories: ["PARTS_SELLER", "GEAR_SELLER"],
      products: [
        { title: "Woodcraft Frame Sliders - KTM RC390", price: 4200, cat: "Parts", sub: "Guards" },
        { title: "Puig Racing Screen - Clear/Smoke", price: 3800, cat: "Parts", sub: "Guards" },
        { title: "Bonamici Folding Levers Set - Gold", price: 5600, cat: "Parts", sub: "Guards" },
        { title: "Rizoma Bar End Weights - Pair", price: 2800, cat: "Accessories", sub: "Mirror" },
        { title: "GYTR Quick Shifter - Universal", price: 12000, cat: "Parts", sub: "Filters" },
        { title: "Oxford Heated Grips Premium - 120mm", price: 4500, cat: "Accessories", sub: "Charger" },
        { title: "Datatag Security System - Full Kit", price: 6800, cat: "Accessories", sub: "Safety" },
        { title: "Garmin Zumo XT2 GPS Mount Bundle", price: 38000, cat: "Accessories", sub: "GPS" },
        { title: "Airhawk R Seat Cushion - Medium", price: 7200, cat: "Accessories", sub: "Luggage" },
        { title: "BikeTrac Tracker + 1yr Subscription", price: 8500, cat: "Accessories", sub: "Safety" },
        { title: "SW-Motech Crashbars - RE Himalayan", price: 9200, cat: "Parts", sub: "Guards" },
        { title: "Motul 300V Factory Line 10W-40 4L", price: 3200, cat: "Parts", sub: "Oil" },
      ],
    },
  ];

  const brandProfiles: any[] = [];
  for (let bi = 0; bi < BRANDS.length; bi++) {
    const brand = BRANDS[bi];
    const coords = coordsNear(brand.cityKey, bi * 31);

    // Create a brand owner user
    const brandOwner = await createUserWithRoles(
      {
        email: brand.email,
        username: brand.username,
        name: brand.name,
        emailVerified: true,
        phoneVerified: true,
        bio: brand.description.slice(0, 160),
        location: `${brand.city}, India`,
        avatar: BRAND_LOGO_URLS[bi % BRAND_LOGO_URLS.length],
        coverImage: BRAND_BANNER_URLS[bi % BRAND_BANNER_URLS.length],
        subscriptionTier: "PRO",
      },
      ["BRAND_OWNER"],
      hashedPassword,
    );

    const bp = await prisma.businessProfile.create({
      data: {
        ownerId: brandOwner.id,
        categories: brand.categories as any[],
        displayName: brand.name,
        slug: brand.slug,
        tagline: brand.tagline,
        description: brand.description,
        logoUrl: BRAND_LOGO_URLS[bi % BRAND_LOGO_URLS.length],
        bannerUrl: BRAND_BANNER_URLS[bi % BRAND_BANNER_URLS.length],
        city: brand.city,
        country: "India",
        latitude: coords.lat,
        longitude: coords.lng,
        verification: "APPROVED",
        phone: `+91${9800000000 + bi}`,
        email: brand.email,
        websiteUrl: `https://${brand.slug}.in`,
        pricingTier: "PRO",
      },
    });
    brandProfiles.push(bp);

    // Create 12 marketplace listings for this brand
    for (let pi = 0; pi < brand.products.length; pi++) {
      const p = brand.products[pi];
      const pCoords = coordsNear(brand.cityKey, bi * 13 + pi);
      await prisma.marketplaceListing.create({
        data: {
          title: p.title,
          description: `${p.title} — Official ${brand.name} product. Genuine quality, fast shipping, warranty included.`,
          price: p.price,
          currency: "INR",
          category: p.cat,
          subcategory: p.sub,
          condition: pi % 3 === 0 ? "New" : "New",
          images: listingImagesFor(p.sub, bi * 7 + pi),
          status: ListingStatus.ACTIVE,
          featured: pi < 3,
          latitude: pCoords.lat,
          longitude: pCoords.lng,
          sellerId: brandOwner.id,
        },
      });
    }
    listings.push(...Array(brand.products.length).fill(null));
  }
  console.log(`✅ Created ${BRANDS.length} brand profiles with ${BRANDS.reduce((s, b) => s + b.products.length, 0)} products`);

  // ── Ad Campaigns ─────────────────────────────────────────────────
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const AD_TEMPLATES = [
    {
      title: "Gear Up This Season — 15% Off",
      ctaLabel: "Shop Now",
      imageUrl: "https://images.unsplash.com/photo-1609630875171-b1321377ee65?w=1200",
      slots: ["HOME_FEED", "MARKETPLACE_INLINE"],
      targetTags: ["gear", "helmet", "bangalore"],
      budgetPaise: 500000,
      impressionCap: 10000,
    },
    {
      title: "New Arrivals: Adventure Bikes 2025",
      ctaLabel: "View Range",
      imageUrl: "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=1200",
      slots: ["HOME_FEED", "DISCOVER_TOP"],
      targetTags: ["adventure", "motorcycle", "touring"],
      budgetPaise: 800000,
      impressionCap: 20000,
    },
    {
      title: "Book a Track Day — Limited Slots",
      ctaLabel: "Register",
      imageUrl: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=1200",
      slots: ["POST_RIDE_SUMMARY", "HOME_FEED"],
      targetTags: ["track", "performance", "race"],
      budgetPaise: 300000,
      impressionCap: 5000,
    },
    {
      title: "Free Tyre Check at Your Doorstep",
      ctaLabel: "Book Now",
      imageUrl: "https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?w=1200",
      slots: ["MARKETPLACE_INLINE", "CHAT_LIST_TOP"],
      targetTags: ["service", "tyres", "maintenance"],
      budgetPaise: 200000,
      impressionCap: 8000,
    },
    {
      title: "Premium Riding Jackets — Members Get 20% Off",
      ctaLabel: "Claim Discount",
      imageUrl: "https://images.unsplash.com/photo-1520975916090-3105956dac38?w=1200",
      slots: ["HOME_FEED", "MARKETPLACE_INLINE"],
      targetTags: ["jacket", "gear", "discount"],
      budgetPaise: 600000,
      impressionCap: 15000,
    },
  ];

  let adCount = 0;
  let discountCount = 0;
  let brandPostCount = 0;

  for (let bi = 0; bi < brandProfiles.length && bi < AD_TEMPLATES.length; bi++) {
    const bp = brandProfiles[bi];
    const brand = BRANDS[bi];
    const tpl = AD_TEMPLATES[bi];

    await prisma.adCampaign.create({
      data: {
        id: `seed_ad_${bi}`,
        businessId: bp.id,
        title: tpl.title,
        ctaLabel: tpl.ctaLabel,
        ctaUrl: `https://${brand.slug}.in`,
        deepLink: `business/${bp.id}`,
        imageUrl: tpl.imageUrl,
        startsAt: now,
        endsAt: in30,
        budgetPaise: tpl.budgetPaise,
        status: "ACTIVE",
        slots: tpl.slots as any[],
        targetTags: tpl.targetTags,
        impressionCap: tpl.impressionCap,
      },
    });
    adCount++;

    // One featured discount per brand
    await prisma.discount.create({
      data: {
        id: `seed_disc_${bi}`,
        businessId: bp.id,
        code: `REVVIE${bi + 10}`,
        title: `${brand.name} — Revvie Exclusive ${10 + bi * 2}% Off`,
        description: `Exclusive discount for Revvie riders. Use code at checkout on ${brand.name}'s website or in-store.`,
        imageUrl: tpl.imageUrl,
        percentOff: 10 + bi * 2,
        validFrom: now,
        validUntil: in30,
        isFeatured: bi < 3,
      },
    });
    discountCount++;

    // Two brand posts per brand so they appear in the community feed
    const brandOwnerUser = await prisma.user.findFirst({
      where: { email: brand.email },
      select: { id: true },
    });
    if (brandOwnerUser) {
      const brandPostContents = [
        `🏍️ Introducing our latest collection for serious riders. Quality that speaks for itself. Check out ${brand.name} on Revvie!`,
        `We're proud to be part of the Revvie rider community. Swing by our store or browse our listings to gear up for your next ride. #RideMore`,
      ];
      for (let pi = 0; pi < 2; pi++) {
        await prisma.post.create({
          data: {
            type: "content",
            content: brandPostContents[pi],
            images: [tpl.imageUrl],
            authorId: brandOwnerUser.id,
          },
        });
        brandPostCount++;
      }
    }
  }
  console.log(`✅ Created ${adCount} ad campaigns, ${discountCount} discounts, ${brandPostCount} brand posts`);

  console.log("\n🎉 Development seed completed!");
  console.log("\n📊 Summary:");
  console.log(
    `   - Users: ${allUsers.length} (1 admin, ${createdUsers.length} riders)`,
  );
  console.log(`   - Friendships: ${friendshipPairs.length} (≥5 per user)`);
  console.log(`   - Clubs: ${clubs.length}`);
  console.log(`   - Rides: ${rides.length}`);
  console.log(`   - Listings: ${listings.length}`);
  console.log(`   - Posts: ${posts.length}`);
  console.log(`   - Friend Groups: ${friendGroups.length}`);
  console.log(`   - Reports: ${reportData.length}`);
  console.log(`   - Brands: ${brandProfiles.length}`);
  console.log("\n🔑 Credentials (password: password123):");
  console.log("   admin@revvie.com      → ADMIN + CLUB_OWNER");
  for (const u of devUsers)
    console.log(`   ${u.email.padEnd(24)} → ${u.roles.join(", ")}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
