import prisma from "./prisma.js";

/**
 * XP awards per action — aligned with Gamification Spec v2.0.
 * Anti-PBL principles: Points represent real asphalt and trail miles.
 * Arbitrary social clicks (adding friends, joining clubs) award 0 XP.
 * Riding distance awards 1 XP per km via awardDistanceXp().
 */
export const XP_REWARDS = {
  RIDE_CREATED: 20,
  RIDE_COMPLETED: 30, // Base completion bonus (distance XP added on top)
  RIDE_JOINED: 10,
  GROUP_RIDE_LEAD: 50, // Road Captain leadership bonus
  GROUP_RIDE_SWEEP: 35, // Sweep safety bonus
  POST_CREATED: 5,
  CLUB_JOINED: 0, // 0 to avoid synthetic club-joining spam
  FRIEND_ADDED: 0, // 0 to avoid friend-request farming
  RATING_GIVEN: 2,
} as const;

export type XpAction = keyof typeof XP_REWARDS;

const LEVEL_THRESHOLD = 250;

/**
 * Recompute level from total XP.
 * Early progression: 250 XP per level.
 */
export function levelForXp(xp: number): { level: number; title: string } {
  const level = Math.max(1, Math.floor(xp / LEVEL_THRESHOLD) + 1);
  const titles = [
    "Rookie",        // 1: 0 - 249 XP
    "Cruiser",       // 2: 250 - 499 XP
    "Day Tripper",   // 3: 500 - 749 XP
    "Weekender",     // 4: 750 - 999 XP
    "Tourer",        // 5: 1000 - 1249 XP
    "Pacer",         // 6: 1250 - 1499 XP
    "Road Captain",  // 7: 1500 - 1749 XP
    "Adventurer",    // 8: 1750 - 1999 XP
    "Ironbutt",      // 9: 2000 - 2249 XP
    "Legend",        // 10+: 2250+ XP
  ];
  const title = titles[Math.min(level - 1, titles.length - 1)];
  return { level, title };
}

/**
 * Award a specific action's XP reward to a user.
 */
export async function awardXp(
  userId: string,
  action: XpAction,
  reason?: string,
): Promise<{ xpPoints: number; level: number; levelTitle: string } | null> {
  const reward = XP_REWARDS[action];
  if (!reward || reward <= 0) return null;
  return awardDirectXp(userId, reward, reason ? `${action} (${reason})` : action);
}

/**
 * Award XP proportional to verified riding distance (1 XP per km).
 */
export async function awardDistanceXp(
  userId: string,
  distanceKm: number,
  reason?: string,
): Promise<{ xpPoints: number; level: number; levelTitle: string } | null> {
  const validKm = Math.max(0, Math.round(distanceKm));
  if (validKm <= 0) return null;
  return awardDirectXp(userId, validKm, reason ?? `Distance: ${validKm}km`);
}

/**
 * Award an arbitrary amount of XP atomically.
 * Recomputes level and levelTitle.
 */
export async function awardDirectXp(
  userId: string,
  amount: number,
  reason?: string,
): Promise<{ xpPoints: number; level: number; levelTitle: string } | null> {
  if (amount <= 0) return null;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { xpPoints: true, level: true, levelTitle: true },
    });
    if (!user) return null;

    const newXp = (user.xpPoints ?? 0) + amount;
    const { level, title } = levelForXp(newXp);

    await prisma.user.update({
      where: { id: userId },
      data: {
        xpPoints: newXp,
        level,
        levelTitle: title,
      },
    });

    if (level > (user.level ?? 1)) {
      console.log(
        `[xp] user ${userId} leveled up: ${user.level} → ${level} (${title})`,
        reason ? `via ${reason}` : "",
      );
    }

    return { xpPoints: newXp, level, levelTitle: title };
  } catch (error) {
    console.warn("[xp] award failed for user", userId, amount, error);
    return null;
  }
}

/**
 * Best-effort badge auto-award by title.
 */
export async function awardBadgeByTitle(
  userId: string,
  badgeTitle: string,
): Promise<boolean> {
  try {
    const badge = await prisma.badge.findUnique({
      where: { title: badgeTitle },
      select: { id: true, auraPoints: true },
    });
    if (!badge) return false;

    // upsert so awarding the same badge twice is a no-op
    await prisma.userBadge.upsert({
      where: { userId_badgeId: { userId, badgeId: badge.id } },
      create: { userId, badgeId: badge.id },
      update: {},
    });
    return true;
  } catch (error) {
    console.warn("[xp] badge award failed", userId, badgeTitle, error);
    return false;
  }
}

export interface RideEvaluationMetrics {
  distanceKm: number;
  elevationM?: number;
  isNight?: boolean;
  isLead?: boolean;
}

/**
 * Evaluate and award authentic motorcycle competence badges upon ride completion.
 */
export async function evaluateAndAwardRideBadges(
  userId: string,
  metrics: RideEvaluationMetrics,
): Promise<string[]> {
  const awarded: string[] = [];

  try {
    // 1. First ride badge
    const completedRides = await prisma.rideParticipant.count({
      where: { userId, status: "ACCEPTED" },
    });
    if (completedRides <= 1) {
      if (await awardBadgeByTitle(userId, "First Ride")) {
        awarded.push("First Ride");
      }
    }

    // 2. Single-ride distance milestones
    if (metrics.distanceKm >= 300) {
      if (await awardBadgeByTitle(userId, "Iron Saddle")) {
        awarded.push("Iron Saddle");
      }
    }
    if (metrics.distanceKm >= 200) {
      if (await awardBadgeByTitle(userId, "Double Century")) {
        awarded.push("Double Century");
      }
    }
    if (metrics.distanceKm >= 100) {
      if (await awardBadgeByTitle(userId, "Century Rider")) {
        awarded.push("Century Rider");
      }
    }

    // 3. Elevation mastery
    if ((metrics.elevationM ?? 0) >= 1000) {
      if (await awardBadgeByTitle(userId, "Mountain Pioneer")) {
        awarded.push("Mountain Pioneer");
      }
    }

    // 4. Cumulative stats check from userRideStats
    const stats = await prisma.userRideStats.findUnique({
      where: { userId },
      select: { totalDistanceKm: true, nightRides: true },
    });

    if (stats) {
      if (stats.totalDistanceKm >= 1000) {
        if (await awardBadgeByTitle(userId, "1000 KM Club")) {
          awarded.push("1000 KM Club");
        }
      }
      if (stats.nightRides >= 5) {
        if (await awardBadgeByTitle(userId, "Night Navigator")) {
          awarded.push("Night Navigator");
        }
      }
    }

    // 5. Leadership check
    if (metrics.isLead) {
      const ledCount = await prisma.ride.count({
        where: { creatorId: userId, status: "COMPLETED" },
      });
      if (ledCount >= 3) {
        if (await awardBadgeByTitle(userId, "Road Captain")) {
          awarded.push("Road Captain");
        }
      }
    }
  } catch (err) {
    console.warn("[xp] evaluateAndAwardRideBadges error for user", userId, err);
  }

  return awarded;
}
