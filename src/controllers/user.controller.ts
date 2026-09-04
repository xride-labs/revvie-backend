import { normalizeEmail, getPhoneVariants } from "../lib/utils/validation.js";
import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../config/auth.js";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
import { requireAdmin } from "../middlewares/rbac.js";
import { z } from "zod";

function buildUserProfileResponse(user: any) {
  if (!user) return user;
  const { password, ...safeUser } = user;
  return safeUser;
}
export class UserController {
  static async getLeaderboard(req: Request, res: Response) {

    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      100,
    );
    const scope =
      String(req.query.scope ?? "global").toLowerCase() === "city"
        ? "city"
        : "global";
    const city =
      typeof req.query.city === "string" && req.query.city.trim()
        ? req.query.city.trim()
        : null;

    // City scope is best-effort: User.location is free-text, so we
    // case-insensitively contains-match. With scope=city but no city
    // supplied, fall back to global.
    const where =
      scope === "city" && city
        ? { location: { contains: city, mode: "insensitive" as const } }
        : {};

    const users = await prisma.user.findMany({
      where,
      orderBy: [{ xpPoints: "desc" }, { level: "desc" }, { createdAt: "asc" }],
      take: limit,
      select: {
        id: true,
        username: true,
        name: true,
        avatar: true,
        location: true,
        xpPoints: true,
        level: true,
        levelTitle: true,
        subscriptionTier: true,
      },
    });

    const ranked = users.map((u, idx) => ({
      rank: idx + 1,
      ...u,
      xpPoints: u.xpPoints ?? 0,
    }));

    ApiResponse.success(res, { scope, city, leaderboard: ranked });
  
  }

  static async getRoot(req: Request, res: Response) {

    const { page, limit, role, search } = req.query as any;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (role) {
      where.userRoles = { some: { role } };
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { username: { contains: search, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        where,
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          avatar: true,
          bio: true,
          location: true,
          bloodType: true,
          phone: true,
          emailVerified: true,
          phoneVerified: true,
          xpPoints: true,
          level: true,
          levelTitle: true,
          activityLevel: true,
          reputationScore: true,
          userRoles: { select: { role: true } },
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);

    const usersWithRoles = users.map(({ userRoles, ...u }) => ({
      ...u,
      roles: userRoles.map((r) => r.role),
    }));

    ApiResponse.paginated(res, usersWithRoles, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  
  }

  static async postContactsMatch(req: Request, res: Response) {

    const session = (req as any).session;
    const { contacts } = req.body as {
      contacts: Array<{ name?: string; phone?: string; email?: string }>;
    };

    const emailToContactName = new Map<string, string | undefined>();
    const phoneVariantToContactName = new Map<string, string | undefined>();
    const emailConditions: Array<Record<string, unknown>> = [];
    const phoneVariants = new Set<string>();

    for (const contact of contacts) {
      const normalizedEmail = contact.email ? normalizeEmail(contact.email) : undefined;
      if (normalizedEmail) {
        emailToContactName.set(normalizedEmail, contact.name);
      }

      const variants = contact.phone ? getPhoneVariants(contact.phone) : [];
      variants.forEach((variant) => {
        phoneVariants.add(variant);
        if (!phoneVariantToContactName.has(variant)) {
          phoneVariantToContactName.set(variant, contact.name);
        }
      });
    }

    for (const email of emailToContactName.keys()) {
      emailConditions.push({
        email: {
          equals: email,
          mode: "insensitive",
        },
      });
    }

    const phoneCondition = phoneVariants.size
      ? {
          phone: {
            in: Array.from(phoneVariants),
          },
        }
      : null;

    const whereOr = [
      ...emailConditions,
      ...(phoneCondition ? [phoneCondition] : []),
    ];

    if (whereOr.length === 0) {
      return ApiResponse.success(res, {
        matches: [],
        summary: {
          scannedContacts: contacts.length,
          matchedUsers: 0,
        },
      });
    }

    const users = await prisma.user.findMany({
      where: {
        id: { not: session.user.id },
        OR: whereOr as any,
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        email: true,
        phone: true,
        preferences: {
          select: {
            openToInvite: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const matches = users
      .filter((user) => user.preferences?.openToInvite !== false)
      .map((user) => {
        const matchedBy: Array<"email" | "phone"> = [];
        const contactNames: string[] = [];

        const normalizedEmail = user.email ? normalizeEmail(user.email) : undefined;
        if (normalizedEmail && emailToContactName.has(normalizedEmail)) {
          matchedBy.push("email");
          const name = emailToContactName.get(normalizedEmail);
          if (name) contactNames.push(name);
        }

        const userPhoneVariants = user.phone ? getPhoneVariants(user.phone) : [];
        const phoneMatch = userPhoneVariants.find((variant) =>
          phoneVariantToContactName.has(variant),
        );
        if (phoneMatch) {
          matchedBy.push("phone");
          const name = phoneVariantToContactName.get(phoneMatch);
          if (name) contactNames.push(name);
        }

        return {
          user: {
            id: user.id,
            name: user.name,
            username: user.username,
            avatar: user.avatar,
          },
          contactName: contactNames[0] || null,
          matchedBy,
        };
      })
      .filter((match) => match.matchedBy.length > 0);

    ApiResponse.success(res, {
      matches,
      summary: {
        scannedContacts: contacts.length,
        matchedUsers: matches.length,
      },
    });
  
  }

  static async getById(req: Request, res: Response) {

    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: { select: { role: true } },
        bikes: true,
        badges: { include: { badge: true } },
        emergencyContacts: true,
        preferences: true,
        rideStats: true,
        clubMemberships: { include: { club: true } },
        _count: {
          select: {
            createdRides: true,
            createdClubs: true,
            followers: true,
            following: true,
            friendsInitiated: true,
            friendsReceived: true,
          },
        },
      },
    });

    if (!user) {
      return ApiResponse.notFound(
        res,
        "User not found",
        ErrorCode.USER_NOT_FOUND,
      );
    }

    const friendsCount =
      (user._count?.friendsInitiated ?? 0) +
      (user._count?.friendsReceived ?? 0);
    const userWithFriends = { ...user, friendsCount };
    ApiResponse.success(res, {
      user: buildUserProfileResponse(userWithFriends),
    });
  
  }

  static async patchById(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    const isSelf = session.user.id === id;
    if (!isSelf) {
      // Check if requester has admin role
      const adminRole = await prisma.userRoleAssignment.findFirst({
        where: {
          userId: session.user.id,
          role: { in: ["ADMIN"] },
        },
      });

      if (!adminRole) {
        return ApiResponse.forbidden(
          res,
          "You don't have permission to update this user",
        );
      }
    }

    const {
      email,
      username,
      name,
      bio,
      location,
      bloodType,
      avatar,
      coverImage,
      dob,
      phone,
    } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(email !== undefined && { email }),
        ...(username !== undefined && { username }),
        ...(name !== undefined && { name }),
        ...(bio !== undefined && { bio }),
        ...(location !== undefined && { location }),
        ...(bloodType !== undefined && { bloodType }),
        ...(avatar !== undefined && { avatar }),
        ...(coverImage !== undefined && { coverImage }),
        ...(dob !== undefined && { dob: new Date(dob) }),
        ...(phone !== undefined && { phone }),
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        avatar: true,
        coverImage: true,
        bio: true,
        location: true,
        bloodType: true,
        dob: true,
        phone: true,
        userRoles: { select: { role: true } },
        updatedAt: true,
      },
    });

    const { userRoles: updatedRoles, ...userData } = user;
    ApiResponse.success(
      res,
      { user: { ...userData, roles: updatedRoles.map((r) => r.role) } },
      "User updated successfully",
    );
  
  }

  static async getByIdRoles(req: Request, res: Response) {

    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        userRoles: {
          select: {
            role: true,
            assignedAt: true,
          },
          orderBy: { assignedAt: "desc" },
        },
      },
    });

    if (!user) {
      return ApiResponse.notFound(
        res,
        "User not found",
        ErrorCode.USER_NOT_FOUND,
      );
    }

    ApiResponse.success(res, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.userRoles,
      },
    });
  
  }

  static async postByIdRoles(req: Request, res: Response) {

    const { id } = req.params;
    const { role } = req.body;

    const validRoles = [
      "ADMIN", "CO_ADMIN", "MODERATOR", 
      "CLUB_OWNER", "CLUB_ADMIN", "CLUB_MODERATOR",
      "BRAND_OWNER", "BRAND_ADMIN", "BRAND_MODERATOR",
      "RIDER", "SELLER"
    ];
    
    if (!validRoles.includes(role)) {
      return ApiResponse.validationError(res, {
        role: [`Invalid role. Must be one of: ${validRoles.join(", ")}`],
      });
    }

    // Check if role already exists
    const existingRole = await prisma.userRoleAssignment.findUnique({
      where: { userId_role: { userId: id, role } },
    });

    if (existingRole) {
      return ApiResponse.error(
        res,
        "User already has this role",
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    // Add the role
    await prisma.userRoleAssignment.create({
      data: { userId: id, role },
    });

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        userRoles: { select: { role: true, assignedAt: true } },
      },
    });

    ApiResponse.success(
      res,
      { 
        user: {
          id: user?.id,
          email: user?.email,
          name: user?.name,
          roles: user?.userRoles || [],
        },
      },
      "Role added successfully",
    );
  
  }

  static async deleteByIdRolesByRole(req: Request, res: Response) {

    const { id, role } = req.params;

    const existingRole = await prisma.userRoleAssignment.findUnique({
      where: { userId_role: { userId: id, role: role as any } },
    });

    if (!existingRole) {
      return ApiResponse.notFound(res, "Role not found for this user");
    }

    await prisma.userRoleAssignment.delete({
      where: { userId_role: { userId: id, role: role as any } },
    });

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        userRoles: { select: { role: true, assignedAt: true } },
      },
    });

    ApiResponse.success(
      res,
      { 
        user: {
          id: user?.id,
          email: user?.email,
          name: user?.name,
          roles: user?.userRoles || [],
        },
      },
      "Role removed successfully",
    );
  
  }

  static async deleteById(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    const isSelf = session.user.id === id;
    if (!isSelf) {
      const adminRole = await prisma.userRoleAssignment.findFirst({
        where: {
          userId: session.user.id,
          role: { in: ["ADMIN"] },
        },
      });

      if (!adminRole) {
        return ApiResponse.forbidden(
          res,
          "You don't have permission to delete this user",
        );
      }
    }

    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existingUser) {
      return ApiResponse.notFound(
        res,
        "User not found",
        ErrorCode.USER_NOT_FOUND,
      );
    }

    await prisma.user.delete({ where: { id } });

    ApiResponse.success(res, null, "User deleted successfully");
  
  }

  static async getByIdRides(req: Request, res: Response) {

    const { id } = req.params;
    const { page, limit, status, search } = req.query as any;
    const skip = (page - 1) * limit;

    const where: any = { creatorId: id };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { participants: true } },
        },
      }),
      prisma.ride.count({ where }),
    ]);

    ApiResponse.paginated(res, rides, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  
  }

  static async getByIdClubs(req: Request, res: Response) {

    const { id } = req.params;
    const { page, limit, search } = req.query as any;
    const skip = (page - 1) * limit;

    const where: any = { ownerId: id };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [clubs, total] = await Promise.all([
      prisma.club.findMany({
        where,
        include: {
          _count: { select: { members: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.club.count({ where }),
    ]);

    ApiResponse.paginated(res, clubs, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  
  }

  static async getMeBikes(req: Request, res: Response) {

    const session = (req as any).session;
    const bikes = await prisma.bike.findMany({
      where: { userId: session.user.id },
      include: {
        bikeModel: {
          include: { manufacturer: true },
        },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
    });
    ApiResponse.success(res, bikes, "Bikes retrieved");
  
  }

  static async postMeBikes(req: Request, res: Response) {

    const session = (req as any).session;
    const bikeData = req.body;

    if (bikeData.isPrimary) {
      await prisma.bike.updateMany({
        where: { userId: session.user.id },
        data: { isPrimary: false },
      });
    }

    const bike = await prisma.bike.create({
      data: {
        ...bikeData,
        // Year is required at the DB level. Onboarding's quick-add only
        // collects make + model — fall back to the current year so the row
        // is valid; the user can fix it later from the bike detail screen.
        year: bikeData.year ?? new Date().getFullYear(),
        userId: session.user.id,
      },
    });

    ApiResponse.created(res, bike, "Bike added to garage");
  
  }

  static async patchMeBikesByBikeId(req: Request, res: Response) {

    const session = (req as any).session;
    const { bikeId } = req.params;
    const bikeData = req.body;

    const existing = await prisma.bike.findFirst({
      where: { id: bikeId, userId: session.user.id },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Bike not found in your garage");
    }

    if (bikeData.isPrimary) {
      await prisma.bike.updateMany({
        where: { userId: session.user.id, id: { not: bikeId } },
        data: { isPrimary: false },
      });
    }

    const updated = await prisma.bike.update({
      where: { id: bikeId },
      data: bikeData,
    });

    ApiResponse.success(res, updated, "Bike updated");
  
  }

  static async deleteMeBikesByBikeId(req: Request, res: Response) {

    const session = (req as any).session;
    const { bikeId } = req.params;

    const existing = await prisma.bike.findFirst({
      where: { id: bikeId, userId: session.user.id },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Bike not found in your garage");
    }

    await prisma.bike.delete({
      where: { id: bikeId },
    });

    ApiResponse.success(res, null, "Bike removed from garage");
  
  }

  static async postByIdFollow(req: Request, res: Response) {

    const session = (req as any).session;
    const followerId = session.user.id;
    const { id: followingId } = req.params;

    if (followerId === followingId) {
      return ApiResponse.error(
        res,
        "You cannot follow yourself",
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const target = await prisma.user.findUnique({
      where: { id: followingId },
      select: { id: true },
    });
    if (!target) {
      return ApiResponse.notFound(res, "User not found", ErrorCode.USER_NOT_FOUND);
    }

    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId, followingId } },
      create: { followerId, followingId },
      update: {},
    });

    const [followerCount, followingCount] = await Promise.all([
      prisma.follow.count({ where: { followingId } }),
      prisma.follow.count({ where: { followerId } }),
    ]);

    ApiResponse.success(
      res,
      { isFollowing: true, followerCount, followingCount },
      "Followed successfully",
    );

  }

  static async postByIdUnfollow(req: Request, res: Response) {

    const session = (req as any).session;
    const followerId = session.user.id;
    const { id: followingId } = req.params;

    await prisma.follow.deleteMany({ where: { followerId, followingId } });

    const [followerCount, followingCount] = await Promise.all([
      prisma.follow.count({ where: { followingId } }),
      prisma.follow.count({ where: { followerId } }),
    ]);

    ApiResponse.success(
      res,
      { isFollowing: false, followerCount, followingCount },
      "Unfollowed successfully",
    );

  }

  static async patchMeGhostMode(req: Request, res: Response) {

    const session = (req as any).session;
    const enabled = req.body?.enabled === true;
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        ghostModeEnabled: enabled,
        ghostModeSince: enabled ? new Date() : null,
      },
      select: {
        id: true,
        ghostModeEnabled: true,
        ghostModeSince: true,
      },
    });
    ApiResponse.success(
      res,
      {
        ghostModeEnabled: user.ghostModeEnabled,
        ghostModeSince: user.ghostModeSince,
      },
      enabled ? "Ghost mode enabled" : "Ghost mode disabled",
    );
  
  }

}
