import { ItineraryTheme, DurationTier, RideStatus, RideParticipantStatus } from "@prisma/client";
import prisma from "../../lib/prisma.js";

export interface CuratedItineraryFilters {
  theme?: ItineraryTheme;
  durationTier?: DurationTier;
  corridor?: string;
  region?: string;
  minRating?: number;
  page?: number;
  limit?: number;
  sortBy?: "rating" | "distance" | "duration";
}

export interface CuratedPlaceFilters {
  corridor?: string;
  category?: string;
  minRating?: number;
  region?: string;
  tag?: string;
  page?: number;
  limit?: number;
}

export interface ScheduleItineraryOptions {
  scheduledAt: string | Date;
  title?: string;
  pace?: string;
  experienceLevel?: string;
  isPrivate?: boolean;
}

/**
 * Get paginated list of curated itineraries matching filters
 */
export async function getCuratedItineraries(filters: CuratedItineraryFilters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(filters.limit) || 20));
  const skip = (page - 1) * limit;

  const where: any = {
    isPublished: true
  };

  if (filters.theme) where.theme = filters.theme;
  if (filters.durationTier) where.durationTier = filters.durationTier;
  if (filters.corridor) where.corridor = filters.corridor;
  if (filters.region) where.region = filters.region;
  if (filters.minRating) where.rating = { gte: Number(filters.minRating) };

  let orderBy: any = { rating: "desc" };
  if (filters.sortBy === "distance") orderBy = { distanceKm: "asc" };
  else if (filters.sortBy === "duration") orderBy = { durationMinutes: "asc" };

  const [total, items] = await Promise.all([
    prisma.curatedItinerary.count({ where }),
    prisma.curatedItinerary.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        _count: {
          select: { waypoints: true }
        }
      }
    })
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Get full dossier for a single curated itinerary
 */
export async function getCuratedItineraryById(id: string) {
  const itinerary = await prisma.curatedItinerary.findUnique({
    where: { id },
    include: {
      waypoints: {
        orderBy: { order: "asc" },
        include: {
          place: true
        }
      }
    }
  });

  if (!itinerary) {
    const error: any = new Error("Curated itinerary not found");
    error.statusCode = 404;
    throw error;
  }

  return itinerary;
}

/**
 * Get paginated list of curated places
 */
export async function getCuratedPlaces(filters: CuratedPlaceFilters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(filters.limit) || 20));
  const skip = (page - 1) * limit;

  const where: any = {
    isCurated: true
  };

  if (filters.corridor) where.corridor = filters.corridor;
  if (filters.category) where.category = filters.category;
  if (filters.region) where.region = filters.region;
  if (filters.minRating) where.rating = { gte: Number(filters.minRating) };
  if (filters.tag) where.tags = { has: filters.tag };

  const [total, items] = await Promise.all([
    prisma.place.count({ where }),
    prisma.place.findMany({
      where,
      orderBy: [{ rating: "desc" }, { distanceFromBlr: "asc" }],
      skip,
      take: limit
    })
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Schedule a curated itinerary as an active user ride
 */
export async function scheduleItineraryAsRide(
  userId: string,
  itineraryId: string,
  options: ScheduleItineraryOptions
) {
  const itinerary = await getCuratedItineraryById(itineraryId);

  // Convert waypoints to ride waypoints format
  const plannedWaypoints = itinerary.waypoints.map((wp) => ({
    name: wp.name,
    latitude: wp.latitude,
    longitude: wp.longitude,
    stopType: wp.stopType,
    notes: wp.notes,
    order: wp.order
  }));

  const scheduledDate = new Date(options.scheduledAt);
  if (isNaN(scheduledDate.getTime())) {
    const error: any = new Error("Invalid scheduled date format");
    error.statusCode = 400;
    throw error;
  }

  // Create the Ride with the current user as creator and participant
  const ride = await prisma.$transaction(async (tx) => {
    const createdRide = await tx.ride.create({
      data: {
        title: options.title?.trim() || itinerary.title,
        description: itinerary.description,
        startLocation: itinerary.startLocationName,
        startLat: itinerary.startLat,
        startLng: itinerary.startLng,
        endLocation: itinerary.endLocationName,
        endLat: itinerary.endLat,
        endLng: itinerary.endLng,
        latitude: itinerary.startLat,
        longitude: itinerary.startLng,
        distance: itinerary.distanceKm,
        duration: itinerary.durationMinutes,
        pace: options.pace || "Moderate",
        experienceLevel: options.experienceLevel || itinerary.difficulty || "Intermediate",
        scheduledAt: scheduledDate,
        status: RideStatus.PLANNED,
        curatedItineraryId: itinerary.id,
        routeData: itinerary.routePolyline || null,
        waypoints: plannedWaypoints,
        creatorId: userId,
        images: itinerary.heroImage ? [itinerary.heroImage] : []
      }
    });

    await tx.rideParticipant.create({
      data: {
        rideId: createdRide.id,
        userId: userId,
        status: RideParticipantStatus.ACCEPTED
      }
    });

    return createdRide;
  });

  return ride;
}
