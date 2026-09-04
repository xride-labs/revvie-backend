import prisma from "../../lib/prisma.js";
import { effectiveStatus } from "./moderation.service.js";
import { ensureAnnouncementsGroup, getGroupChatSummaries } from "./groupChat.service.js";
import { isUserPro, countUserJoinedClubs, FREE_CLUBS_JOINED_LIMIT } from "../../lib/subscription.js";

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
            _count: { select: { members: true, groups: true } },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    });

    const ownedClubs = await prisma.club.findMany({
      where: { ownerId: userId, ...clubSearch },
      include: {
        owner: { select: { id: true, name: true, avatar: true } },
        _count: { select: { members: true, groups: true } },
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

    // Activity summary (unread announcement count + last-activity timestamp)
    // for just this page of clubs — bounded like getClubById's single-club
    // version, not run over the full unpaginated set.
    const activityByClub = new Map<
      string,
      { unreadAnnouncements: number; lastActivityAt: Date | null }
    >();
    await Promise.all(
      paginatedClubs.map(async (club) => {
        try {
          const { groupId } = await ensureAnnouncementsGroup(club.id);
          const summaries = await getGroupChatSummaries([groupId], userId);
          const summary = summaries[groupId];
          activityByClub.set(club.id, {
            unreadAnnouncements: summary?.unreadCount ?? 0,
            lastActivityAt: summary?.lastMessage?.sentAt ?? club.updatedAt ?? null,
          });
        } catch (err) {
          console.error(`[ClubService] getMyClubs activity fetch failed for ${club.id}:`, err);
          activityByClub.set(club.id, {
            unreadAnnouncements: 0,
            lastActivityAt: club.updatedAt ?? null,
          });
        }
      }),
    );

    const clubsWithActivity = paginatedClubs.map((club) => ({
      ...club,
      activeGroupCount: club._count?.groups ?? 0,
      ...activityByClub.get(club.id),
    }));

    return { clubs: clubsWithActivity, total, totalPages: Math.ceil(total / limit) };
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
        _count: { select: { members: true, joinRequests: true, groups: true } },
      },
    });

    if (!club) throw new Error("CLUB_NOT_FOUND");

    // `club.members` above is capped to the 20 most-recently-joined, so a
    // longtime member of a large club can be absent from it — checking
    // membership against that array (as the client used to) silently
    // misreports non-recent members as non-members. Look it up directly.
    const [membership, joinRequest, pendingRequestCount, rideCount] = await Promise.all([
      userId
        ? prisma.clubMember.findUnique({
            where: { clubId_userId: { clubId: id, userId } },
            select: { role: true, status: true, joinedAt: true },
          })
        : Promise.resolve(null),
      userId
        ? prisma.clubJoinRequest.findUnique({
            where: { clubId_userId: { clubId: id, userId } },
            select: { status: true },
          })
        : Promise.resolve(null),
      prisma.clubJoinRequest.count({ where: { clubId: id, status: "PENDING" } }),
      prisma.ride.count({ where: { clubId: id } }),
    ]);

    const isOwner = !!userId && club.ownerId === userId;
    const isMember = isOwner || !!membership;
    const viewerRole = isOwner ? "FOUNDER" : (membership?.role ?? null);

    // Upcoming ride / latest announcement previews are club activity, not
    // just headline stats — gate them behind public-or-member the same way
    // getClubRides() already gates the rides list, so a private club's
    // content isn't visible to a browsing non-member.
    const canSeeActivity = club.isPublic || isMember;

    let upcomingRide = null;
    let latestAnnouncement = null;
    // Exposed even when there's no message yet, so an admin's "post an
    // announcement" action always has somewhere to open — not just once a
    // first message exists to preview.
    let announcementsGroupId: string | null = null;
    let announcementsConversationId: string | null = null;

    if (canSeeActivity) {
      const [ride, announcementInfo] = await Promise.all([
        prisma.ride.findFirst({
          where: { clubId: id, status: "PLANNED", scheduledAt: { gte: new Date() } },
          orderBy: { scheduledAt: "asc" },
          include: {
            creator: { select: { id: true, name: true, avatar: true } },
            _count: { select: { participants: true } },
            participants: userId
              ? { where: { userId }, select: { status: true } }
              : false,
          },
        }),
        (async () => {
          try {
            const { groupId, conversationId } = await ensureAnnouncementsGroup(id);
            const summaries = await getGroupChatSummaries([groupId], userId || "");
            const lastMessage = summaries[groupId]?.lastMessage;
            return {
              groupId,
              conversationId,
              latestMessage: lastMessage
                ? { groupId, conversationId, ...lastMessage }
                : null,
            };
          } catch (err) {
            console.error("[ClubService] announcements fetch failed:", err);
            return null;
          }
        })(),
      ]);
      upcomingRide = ride;
      if (announcementInfo) {
        announcementsGroupId = announcementInfo.groupId;
        announcementsConversationId = announcementInfo.conversationId;
        latestAnnouncement = announcementInfo.latestMessage;
      }
    }

    return {
      ...club,
      isMember,
      isOwner,
      viewerRole,
      joinRequestStatus: joinRequest?.status || null,
      pendingRequestCount,
      rideCount,
      upcomingRide,
      latestAnnouncement,
      announcementsGroupId,
      announcementsConversationId,
    };
  }

  /**
   * Pending/approved/rejected join requests for a club, each annotated with
   * how many friends the requester shares with the viewing admin — the
   * "N mutual friends" line on a request card.
   */
  static async getJoinRequests(
    clubId: string,
    viewerId: string,
    status: "PENDING" | "APPROVED" | "REJECTED" | "ALL",
  ) {
    const where: any = { clubId };
    if (status !== "ALL") where.status = status;

    const requests = await prisma.clubJoinRequest.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, avatar: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const mutualCounts = await this.getMutualFriendsCounts(
      viewerId,
      requests.map((r) => r.userId),
    );

    return {
      requests: requests.map((r) => ({
        ...r,
        mutualFriendsCount: mutualCounts[r.userId] ?? 0,
      })),
    };
  }

  /**
   * Count of accepted-friendship overlap between `viewerId` and each id in
   * `otherIds`. Two queries regardless of list size: the viewer's friend set
   * once, then a single batched lookup of which `otherIds` share a friend
   * with the viewer — not one query per requester.
   */
  private static async getMutualFriendsCounts(
    viewerId: string,
    otherIds: string[],
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = Object.fromEntries(
      otherIds.map((id) => [id, 0]),
    );
    if (!viewerId || !otherIds.length) return counts;

    const viewerFriendships = await prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ senderId: viewerId }, { receiverId: viewerId }],
      },
      select: { senderId: true, receiverId: true },
    });
    const viewerFriendIds = viewerFriendships.map((f) =>
      f.senderId === viewerId ? f.receiverId : f.senderId,
    );
    if (!viewerFriendIds.length) return counts;

    const shared = await prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [
          { senderId: { in: otherIds }, receiverId: { in: viewerFriendIds } },
          { receiverId: { in: otherIds }, senderId: { in: viewerFriendIds } },
        ],
      },
      select: { senderId: true, receiverId: true },
    });

    const otherIdSet = new Set(otherIds);
    for (const f of shared) {
      const otherId = otherIdSet.has(f.senderId) ? f.senderId : f.receiverId;
      counts[otherId] = (counts[otherId] ?? 0) + 1;
    }
    return counts;
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

    const hasPro = await isUserPro(userId);
    if (!hasPro) {
      const joinedCount = await countUserJoinedClubs(userId);
      if (joinedCount >= FREE_CLUBS_JOINED_LIMIT) throw new Error("JOIN_LIMIT_REACHED");
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
