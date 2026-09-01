import prisma from "../../lib/prisma.js";
import { LocationSharingSettings, LocationPermissionInput } from "./location.service.js";

export class LocationSettingsService {
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

  static async setFriendPermission(
    userId: string,
    input: LocationPermissionInput
  ): Promise<void> {
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
        canSee: permission?.canSee ?? true,
        canSeeSpeed: permission?.canSeeSpeed ?? true,
        canSeeBattery: permission?.canSeeBattery ?? false,
      };
    });
  }

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
}
