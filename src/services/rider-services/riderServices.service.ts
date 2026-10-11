import type { BusinessCategory } from "@prisma/client";
import prisma from "../../lib/prisma.js";

export const RIDER_SERVICE_CATEGORIES = [
  "MECHANIC",
  "SERVICE_STORE",
  "PARTS_SELLER",
  "GEAR_SELLER",
  "HELMET_SELLER",
] as const satisfies readonly BusinessCategory[];

export type RiderServiceCategory = (typeof RIDER_SERVICE_CATEGORIES)[number];

export interface NearbyRiderServicesQuery {
  latitude: number;
  longitude: number;
  category?: RiderServiceCategory;
  radiusKm?: number;
  limit?: number;
}

export interface NearbyRiderService {
  id: string;
  displayName: string;
  slug: string;
  categories: BusinessCategory[];
  tagline: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  phone: string | null;
  logoUrl: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
}

const EARTH_RADIUS_KM = 6371;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceKm(
  originLat: number,
  originLng: number,
  destinationLat: number,
  destinationLng: number,
): number {
  const latDelta = radians(destinationLat - originLat);
  const lngDelta = radians(destinationLng - originLng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(originLat)) *
      Math.cos(radians(destinationLat)) *
      Math.sin(lngDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Finds verified Revvie rider services around a coordinate. A SQL bounding box
 * narrows the candidate set before Haversine applies the exact radius and
 * distance ordering in memory.
 */
export async function getNearbyRiderServices(
  query: NearbyRiderServicesQuery,
): Promise<NearbyRiderService[]> {
  const radiusKm = Math.min(Math.max(query.radiusKm ?? 15, 1), 100);
  const limit = Math.min(Math.max(query.limit ?? 40, 1), 50);
  const latitudeDelta = radiusKm / 111.32;
  const longitudeDelta =
    radiusKm / Math.max(111.32 * Math.cos(radians(query.latitude)), 0.01);

  const rows = await prisma.businessProfile.findMany({
    where: {
      verification: "APPROVED",
      categories: {
        hasSome: query.category
          ? [query.category]
          : [...RIDER_SERVICE_CATEGORIES],
      },
      latitude: {
        not: null,
        gte: query.latitude - latitudeDelta,
        lte: query.latitude + latitudeDelta,
      },
      longitude: {
        not: null,
        gte: query.longitude - longitudeDelta,
        lte: query.longitude + longitudeDelta,
      },
    },
    select: {
      id: true,
      displayName: true,
      slug: true,
      categories: true,
      tagline: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      region: true,
      phone: true,
      logoUrl: true,
      latitude: true,
      longitude: true,
    },
  });

  return rows
    .flatMap((row) => {
      if (row.latitude == null || row.longitude == null) return [];
      const distanceKm = haversineDistanceKm(
        query.latitude,
        query.longitude,
        row.latitude,
        row.longitude,
      );
      if (distanceKm > radiusKm) return [];
      return [
        {
          ...row,
          latitude: row.latitude,
          longitude: row.longitude,
          distanceKm: Math.round(distanceKm * 100) / 100,
        },
      ];
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}
