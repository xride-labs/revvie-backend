import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../config/auth.js";
import { z } from "zod";
import { LocationService } from "../services/location/location.service.js";
import { LocationSettingsService } from "../services/location/settings.service.js";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
import { requirePro, isUserPro } from "../lib/subscription.js";
import { broadcastRiderLocation } from "../lib/socket.js";
import prisma from "../lib/prisma.js";

export class LocationController {
  static async postRoot(req: Request, res: Response) {

    const userId = (req as any).session?.user?.id;
    const { isOnRide, rideId, ...rest } = req.body;

    await LocationService.updateLocation({
      userId,
      isOnRide,
      rideId,
      ...rest,
    });

    if (isOnRide && rideId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, avatar: true },
      });
      await broadcastRiderLocation({
        rideId,
        userId,
        name: user?.name || "Rider",
        avatar: user?.avatar,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        heading: req.body.heading,
        speed: req.body.speed,
        altitude: req.body.altitude,
        accuracy: req.body.accuracy,
        isMoving: req.body.isMoving,
      });
    }

    ApiResponse.success(res, null, "Location updated");
  
  }

  static async getSettings(req: Request, res: Response) {

    const userId = (req as any).session?.user?.id;
    const settings = await LocationSettingsService.getSharingSettings(userId);
    ApiResponse.success(res, settings);
  
  }

  static async patchSettings(req: Request, res: Response) {

    const userId = (req as any).session?.user?.id;
    const { expiresInMinutes, ...rest } = req.body;

    const expiresAt = expiresInMinutes
      ? new Date(Date.now() + expiresInMinutes * 60 * 1000)
      : undefined;

    await LocationSettingsService.updateSharingSettings(userId, {
      ...rest,
      expiresAt,
    });

    ApiResponse.success(res, null, "Settings updated");
  
  }

  static async getFriends(req: Request, res: Response) {

    const userId = (req as any).session?.user?.id;
    const locations = await LocationService.getFriendLocations(userId);
    ApiResponse.success(res, { friends: locations });
  
  }

  static async getNearby(req: Request, res: Response) {

    const userId = (req as any).session?.user?.id;
    const locations = await LocationService.getFriendLocations(userId);
    ApiResponse.success(res, { riders: locations, total: locations.length });
  
  }

  static async getFriendsByFriendId(req: Request, res: Response) {

    const userId = (req as any).session?.user?.id;
    const { friendId } = req.params;

    const location = await LocationService.getFriendLocation(userId, friendId);

    if (!location) {
      return ApiResponse.notFound(res, "Location not available");
    }

    ApiResponse.success(res, location);
  
  }

  static async getPermissions(req: Request, res: Response) {

    const userId = (req as any).session?.user?.id;
    const permissions = await LocationSettingsService.getAllPermissions(userId);
    ApiResponse.success(res, { permissions });
  
  }

  static async postPermissions(req: Request, res: Response) {

    const userId = (req as any).session?.user?.id;

    try {
      await LocationSettingsService.setFriendPermission(userId, req.body);
      ApiResponse.success(res, null, "Permission updated");
    } catch (err: any) {
      ApiResponse.error(res, err.message, 400);
    }
  
  }

  static async postGhostMode(req: Request, res: Response) {

    const userId = (req as any).session?.user?.id;
    const { enabled, durationMinutes } = req.body;

    if (enabled) {
      await LocationSettingsService.enableGhostMode(userId, durationMinutes);
      ApiResponse.success(res, null, "Ghost mode enabled");
    } else {
      await LocationSettingsService.disableGhostMode(userId);
      ApiResponse.success(res, null, "Ghost mode disabled");
    }
  
  }

  static async getRideByRideId(req: Request, res: Response) {

    const userId = (req as any).session?.user?.id;
    const { rideId } = req.params;

    try {
      const locations = await LocationService.getRideParticipantLocations(
        rideId,
        userId,
      );
      ApiResponse.success(res, { participants: locations });
    } catch (err: any) {
      ApiResponse.error(res, err.message, 400);
    }
  
  }

}
