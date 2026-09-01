import prisma from "../../lib/prisma.js";
import { effectiveStatus } from "./moderation.service.js";

export class ClubService {
  /**
   * Retrieves a paginated list of clubs based on filters.
   */
  static async getClubs(params: {
    page: number;
    limit: number;
    isPublic?: boolean;
    verified?: boolean;
    search?: string;
  }) {
    const { page, limit, isPublic, verified, search } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (isPublic !== undefined) where.isPublic = isPublic;
    if (verified !== undefined) where.verified = verified;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [clubs, total] = await Promise.all([
      prisma.club.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          owner: { select: { id: true, name: true, avatar: true } },
          _count: { select: { members: true } },
        },
      }),
      prisma.club.count({ where }),
    ]);

    return { clubs, total, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Retrieves a paginated list of clubs the user is a member of or owns.
   */
  static async getMyClubs(userId: string, params: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = params;
    const skip = (page - 1) * limit;

    const clubSearch = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const memberships = await prisma.clubMember.findMany({
      where: { userId, club: clubSearch },
      include: {
        club: {
          include: {
            owner: { select: { id: true, name: true, avatar: true } },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    });

    const ownedClubs = await prisma.club.findMany({
      where: { ownerId: userId, ...clubSearch },
      include: {
        owner: { select: { id: true, name: true, avatar: true } },
        _count: { select: { members: true } },
      },
    });

    const allClubs = [
      ...memberships.map((m) => ({
        ...m.club,
        role: m.role,
        memberCount: m.club._count.members,
      })),
      ...ownedClubs.map((c) => ({
        ...c,
        role: "FOUNDER",
        memberCount: c._count.members,
      })),
    ];

    const uniqueClubs = Array.from(new Map(allClubs.map((c) => [c.id, c])).values());
    const total = uniqueClubs.length;
    const paginatedClubs = uniqueClubs.slice(skip, skip + limit);

    return { clubs: paginatedClubs, total, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Retrieves a paginated list of public discoverable clubs that the user is not in.
   */
  static async discoverClubs(userId: string, params: { page: number; limit: number; search?: string; clubType?: string; location?: string }) {
    const { page, limit, search, clubType, location } = params;
    const skip = (page - 1) * limit;

    const userClubIds = await prisma.clubMember.findMany({
      where: { userId },
      select: { clubId: true },
    });

    const userOwnedClubs = await prisma.club.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });

    const excludeIds = [
      ...userClubIds.map((m) => m.clubId),
      ...userOwnedClubs.map((c) => c.id),
    ];

    const where: any = { isPublic: true, id: { notIn: excludeIds } };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }
    if (clubType) where.clubType = clubType;
    if (location) where.location = { contains: location, mode: "insensitive" };

    const clubs = await prisma.club.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, avatar: true } },
        _count: { select: { members: true } },
      },
      orderBy: { memberCount: "desc" },
      skip,
      take: limit + 1,
    });

    const hasMore = clubs.length > limit;
    const resultClubs = hasMore ? clubs.slice(0, limit) : clubs;

    return {
      clubs: resultClubs.map((c) => ({ ...c, memberCount: c._count.members })),
      hasMore,
    };
  }

  static async getClubById(id: string, userId: string) {
    const club = await prisma.club.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
          orderBy: { joinedAt: "desc" },
          take: 20,
        },
        _count: { select: { members: true, joinRequests: true } },
      },
    });

    if (!club) throw new Error("CLUB_NOT_FOUND");

    let joinRequestStatus: string | null = null;
    if (userId) {
      const joinRequest = await prisma.clubJoinRequest.findUnique({
        where: { clubId_userId: { clubId: id, userId } },
        select: { status: true },
      });
      joinRequestStatus = joinRequest?.status || null;
    }

    const pendingRequestCount = await prisma.clubJoinRequest.count({
      where: { clubId: id, status: "PENDING" },
    });

    return { ...club, joinRequestStatus, pendingRequestCount };
  }

  static async getClubRides(id: string, userId: string, params: { page: number; limit: number; status?: string; search?: string }) {
    const { page, limit, status, search } = params;
    const skip = (page - 1) * limit;

    const club = await prisma.club.findUnique({
      where: { id },
      select: { id: true, isPublic: true, ownerId: true },
    });

    if (!club) throw new Error("CLUB_NOT_FOUND");

    if (!club.isPublic && club.ownerId !== userId) {
      const membership = await prisma.clubMember.findUnique({
        where: { clubId_userId: { clubId: id, userId } },
        select: { id: true },
      });
      if (!membership) throw new Error("NOT_A_MEMBER");
    }

    const where: any = { clubId: id };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { startLocation: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledAt: "desc" },
        include: {
          creator: { select: { id: true, name: true, avatar: true } },
          _count: { select: { participants: true } },
        },
      }),
      prisma.ride.count({ where }),
    ]);

    return { rides, total, totalPages: Math.ceil(total / limit) };
  }

  static async createClub(data: any, ownerId: string) {
    const club = await prisma.club.create({
      data: {
        ...data,
        isPublic: data.isPublic ?? true,
        requiresLicense: data.requiresLicense ?? false,
        ownerId,
      },
      include: {
        owner: { select: { id: true, name: true, avatar: true } },
      },
    });

    await prisma.clubMember.create({
      data: { clubId: club.id, userId: ownerId, role: "FOUNDER" },
    });

    await prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId: ownerId, role: "CLUB_OWNER" } },
      create: { userId: ownerId, role: "CLUB_OWNER" },
      update: {},
    });

    return club;
  }

  static async updateClub(id: string, data: any) {
    return await prisma.club.update({
      where: { id },
      data,
    });
  }

  static async joinClub(id: string, userId: string, message?: string) {
    const club = await prisma.club.findUnique({
      where: { id },
      include: { owner: { select: { id: true, name: true, email: true } } },
    });

    if (!club) throw new Error("CLUB_NOT_FOUND");

    const existing = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId: id, userId } },
    });

    if (existing) {
      if (effectiveStatus(existing) === "BANNED") throw new Error("BANNED");
      throw new Error("ALREADY_MEMBER");
    }

    if (!club.isPublic) {
      const existingRequest = await prisma.clubJoinRequest.findUnique({
        where: { clubId_userId: { clubId: id, userId } },
      });

      if (existingRequest?.status === "PENDING") throw new Error("PENDING_REQUEST");

      const joinRequest = await prisma.clubJoinRequest.upsert({
        where: { clubId_userId: { clubId: id, userId } },
        create: { clubId: id, userId, message: message || null, status: "PENDING" },
        update: { status: "PENDING", message: message || null },
      });

      return { joinRequest, isPrivate: true, club };
    }

    const membership = await prisma.clubMember.create({
      data: { clubId: id, userId, role: "MEMBER" },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });

    await prisma.club.update({
      where: { id },
      data: { memberCount: { increment: 1 } },
    });

    return { membership, isPrivate: false, club };
  }

  static async deleteClub(id: string) {
    await prisma.clubMember.deleteMany({ where: { clubId: id } });
    await prisma.club.delete({ where: { id } });
  }
}
