import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UpdateLocationInput {
  userId: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  battery?: number;
  isMoving?: boolean;
  isOnRide?: boolean;
  rideId?: string;
}

export interface LocationSharingSettings {
  sharingEnabled?: boolean;
  shareWithAll?: boolean;
  ghostMode?: boolean;
  expiresAt?: Date | null;
}

export interface FriendLocation {
  id: string;
  name: string;
  avatar?: string | null;
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  isMoving: boolean;
  isOnRide: boolean;
  rideId?: string | null;
  lastUpdated: Date;
  isOnline: boolean;
}

export interface LocationPermissionInput {
  friendId: string;
  canSee: boolean;
  canSeeSpeed?: boolean;
  canSeeBattery?: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class LocationService {
  /**
   * Update the user's live location
   */
  static async updateLocation(input: UpdateLocationInput): Promise<void> {
    const {
      userId,
      latitude,
      longitude,
      altitude,
      heading,
      speed,
      accuracy,
      battery,
      isMoving,
      isOnRide,
      rideId,
    } = input;

    await prisma.userLiveLocation.upsert({
      where: { userId },
      update: {
        latitude,
        longitude,
        altitude,
        heading,
        speed,
        accuracy,
        battery,
        isMoving: isMoving ?? false,
        isOnRide: isOnRide ?? false,
        rideId,
        updatedAt: new Date(),
      },
      create: {
        userId,
        latitude,
        longitude,
        altitude,
        heading,
        speed,
        accuracy,
        battery,
        isMoving: isMoving ?? false,
        isOnRide: isOnRide ?? false,
        rideId,
        sharingEnabled: true,
        shareWithAll: false,
        ghostMode: false,
      },
    });
  }

  /**
   * Update location sharing settings
   */
  static async updateSharingSettings(
    userId: string,
    settings: LocationSharingSettings
  ): Promise<void> {
    await prisma.userLiveLocation.upsert({
      where: { userId },
      update: {
        sharingEnabled: settings.sharingEnabled,
        shareWithAll: settings.shareWithAll,
        ghostMode: settings.ghostMode,
        expiresAt: settings.expiresAt,
      },
      create: {
        userId,
        latitude: 0,
        longitude: 0,
        sharingEnabled: settings.sharingEnabled ?? true,
        shareWithAll: settings.shareWithAll ?? false,
        ghostMode: settings.ghostMode ?? false,
        expiresAt: settings.expiresAt,
      },
    });
  }

  /**
   * Get a user's location sharing settings
   */
  static async getSharingSettings(userId: string): Promise<{
    sharingEnabled: boolean;
    shareWithAll: boolean;
    ghostMode: boolean;
    expiresAt: Date | null;
  }> {
    const location = await prisma.userLiveLocation.findUnique({
      where: { userId },
      select: {
        sharingEnabled: true,
        shareWithAll: true,
        ghostMode: true,
        expiresAt: true,
      },
    });

    return {
      sharingEnabled: location?.sharingEnabled ?? true,
      shareWithAll: location?.shareWithAll ?? false,
      ghostMode: location?.ghostMode ?? false,
      expiresAt: location?.expiresAt ?? null,
    };
  }

  /**
   * Get friend locations for the map (Snapchat-style)
   * Returns locations of accepted friends who have sharing enabled
   */
  static async getFriendLocations(userId: string): Promise<FriendLocation[]> {
    // Get all accepted friends
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        status: "ACCEPTED",
      },
      select: {
        senderId: true,
        receiverId: true,
      },
    });

    // Extract friend IDs
    const friendIds = friendships.map((f) =>
      f.senderId === userId ? f.receiverId : f.senderId
    );

    if (friendIds.length === 0) {
      return [];
    }

    // Check for specific permissions
    const permissions = await prisma.locationSharePermission.findMany({
      where: {
        userId: { in: friendIds },
        friendId: userId,
      },
      select: {
        userId: true,
        canSee: true,
        canSeeSpeed: true,
      },
    });

    const permissionMap = new Map(
      permissions.map((p) => [p.userId, p])
    );

    // Get locations of friends who are sharing
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes

    const locations = await prisma.userLiveLocation.findMany({
      where: {
        userId: { in: friendIds },
        ghostMode: false,
        sharingEnabled: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
        updatedAt: { gt: staleThreshold },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    // Filter based on permissions and format response
    return locations
      .filter((loc) => {
        const permission = permissionMap.get(loc.userId);
        // If no specific permission, check if friend shares with all
        if (!permission) {
          return loc.shareWithAll;
        }
        return permission.canSee;
      })
      .map((loc) => {
        const permission = permissionMap.get(loc.userId);
        const showSpeed = permission?.canSeeSpeed ?? loc.shareWithAll;
        const isOnline = loc.updatedAt.getTime() > now.getTime() - 5 * 60 * 1000; // 5 minutes

        return {
          id: loc.user.id,
          name: loc.user.name ?? "Unknown",
          avatar: loc.user.avatar,
          latitude: loc.latitude,
          longitude: loc.longitude,
          heading: loc.heading,
          speed: showSpeed ? loc.speed : null,
          isMoving: loc.isMoving,
          isOnRide: loc.isOnRide,
          rideId: loc.rideId,
          lastUpdated: loc.updatedAt,
          isOnline,
        };
      });
  }

  /**
   * Get a specific friend's location
   */
  static async getFriendLocation(
    userId: string,
    friendId: string
  ): Promise<FriendLocation | null> {
    // Check if they are friends
    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: friendId },
          { senderId: friendId, receiverId: userId },
        ],
        status: "ACCEPTED",
      },
    });

    if (!friendship) {
      return null;
    }

    // Check permission
    const permission = await prisma.locationSharePermission.findUnique({
      where: {
        userId_friendId: {
          userId: friendId,
          friendId: userId,
        },
      },
    });

    const location = await prisma.userLiveLocation.findUnique({
      where: { userId: friendId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    if (!location || location.ghostMode || !location.sharingEnabled) {
      return null;
    }

    // Check if expired
    if (location.expiresAt && location.expiresAt < new Date()) {
      return null;
    }

    // Check if they allow this user to see
    if (permission && !permission.canSee) {
      return null;
    }

    if (!permission && !location.shareWithAll) {
      return null;
    }

    const now = new Date();
    const showSpeed = permission?.canSeeSpeed ?? location.shareWithAll;
    const isOnline = location.updatedAt.getTime() > now.getTime() - 5 * 60 * 1000;

    return {
      id: location.user.id,
      name: location.user.name ?? "Unknown",
      avatar: location.user.avatar,
      latitude: location.latitude,
      longitude: location.longitude,
      heading: location.heading,
      speed: showSpeed ? location.speed : null,
      isMoving: location.isMoving,
      isOnRide: location.isOnRide,
      rideId: location.rideId,
      lastUpdated: location.updatedAt,
      isOnline,
    };
  }

  /**
   * Set location sharing permission for a specific friend
   */
  static async setFriendPermission(
    userId: string,
    input: LocationPermissionInput
  ): Promise<void> {
    // Verify friendship exists
    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: input.friendId },
          { senderId: input.friendId, receiverId: userId },
        ],
        status: "ACCEPTED",
      },
    });

    if (!friendship) {
      throw new Error("Not friends with this user");
    }

    await prisma.locationSharePermission.upsert({
      where: {
        userId_friendId: {
          userId,
          friendId: input.friendId,
        },
      },
      update: {
        canSee: input.canSee,
        canSeeSpeed: input.canSeeSpeed,
        canSeeBattery: input.canSeeBattery,
      },
      create: {
        userId,
        friendId: input.friendId,
        canSee: input.canSee,
        canSeeSpeed: input.canSeeSpeed ?? true,
        canSeeBattery: input.canSeeBattery ?? false,
      },
    });
  }

  /**
   * Get all permission settings for a user
   */
  static async getAllPermissions(userId: string): Promise<
    Array<{
      friendId: string;
      friendName: string;
      friendAvatar?: string;
      canSee: boolean;
      canSeeSpeed: boolean;
      canSeeBattery: boolean;
    }>
  > {
    // Get all accepted friends
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        status: "ACCEPTED",
      },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true },
        },
        receiver: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Get existing permissions
    const permissions = await prisma.locationSharePermission.findMany({
      where: { userId },
    });

    const permissionMap = new Map(
      permissions.map((p) => [p.friendId, p])
    );

    return friendships.map((f) => {
      const friend = f.senderId === userId ? f.receiver : f.sender;
      const permission = permissionMap.get(friend.id);

      return {
        friendId: friend.id,
        friendName: friend.name ?? "Unknown",
        friendAvatar: friend.avatar ?? undefined,
        canSee: permission?.canSee ?? true, // Default to visible
        canSeeSpeed: permission?.canSeeSpeed ?? true,
        canSeeBattery: permission?.canSeeBattery ?? false,
      };
    });
  }

  /**
   * Enable ghost mode (hide from everyone)
   */
  static async enableGhostMode(
    userId: string,
    durationMinutes?: number
  ): Promise<void> {
    const expiresAt = durationMinutes
      ? new Date(Date.now() + durationMinutes * 60 * 1000)
      : null;

    await prisma.userLiveLocation.upsert({
      where: { userId },
      update: {
        ghostMode: true,
        expiresAt,
      },
      create: {
        userId,
        latitude: 0,
        longitude: 0,
        ghostMode: true,
        sharingEnabled: false,
        expiresAt,
      },
    });
  }

  /**
   * Disable ghost mode
   */
  static async disableGhostMode(userId: string): Promise<void> {
    await prisma.userLiveLocation.update({
      where: { userId },
      data: {
        ghostMode: false,
        sharingEnabled: true,
        expiresAt: null,
      },
    });
  }

  /**
   * Get locations of participants in a specific ride
   */
  static async getRideParticipantLocations(
    rideId: string,
    requestingUserId: string
  ): Promise<FriendLocation[]> {
    // Verify user is part of the ride or is the creator
    const [participation, ride] = await Promise.all([
      prisma.rideParticipant.findFirst({
        where: {
          rideId,
          userId: requestingUserId,
        },
      }),
      prisma.ride.findUnique({
        where: { id: rideId },
        select: { id: true, creatorId: true },
      }),
    ]);

    if (!participation && ride?.creatorId !== requestingUserId) {
      throw new Error("Not a participant of this ride");
    }

    // Get all ride participants and creator
    const participants = await prisma.rideParticipant.findMany({
      where: {
        rideId,
        status: { in: ["ACCEPTED", "COMPLETED"] },
      },
      select: { userId: true },
    });

    const allMemberIds = new Set(participants.map((p) => p.userId));
    if (ride?.creatorId) {
      allMemberIds.add(ride.creatorId);
    }
    allMemberIds.delete(requestingUserId);

    const participantIds = Array.from(allMemberIds);

    if (participantIds.length === 0) {
      return [];
    }

    // Get their locations (active ride participants share location with the group)
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - 15 * 60 * 1000); // 15 minutes for rides

    const locations = await prisma.userLiveLocation.findMany({
      where: {
        userId: { in: participantIds },
        updatedAt: { gt: staleThreshold },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return locations.map((loc) => ({
      id: loc.user.id,
      name: loc.user.name ?? "Unknown",
      avatar: loc.user.avatar,
      latitude: loc.latitude,
      longitude: loc.longitude,
      heading: loc.heading,
      speed: loc.speed, // Always show speed for ride participants
      isMoving: loc.isMoving,
      isOnRide: loc.isOnRide,
      rideId: loc.rideId,
      lastUpdated: loc.updatedAt,
      isOnline: loc.updatedAt.getTime() > now.getTime() - 2 * 60 * 1000, // 2 minutes for active rides
    }));
  }

  /**
   * Clean up stale locations (run periodically)
   */
  static async cleanupStaleLocations(): Promise<number> {
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours

    const result = await prisma.userLiveLocation.deleteMany({
      where: {
        updatedAt: { lt: staleThreshold },
      },
    });

    return result.count;
  }
}
