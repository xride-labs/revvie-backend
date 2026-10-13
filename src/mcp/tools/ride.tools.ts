import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { McpToolDefinition, ToolContext } from "../types.js";

export const createRideInputSchema = z.object({
  title: z.string().min(1).max(200).describe("Title or name of the ride"),
  startLocation: z.string().min(1).max(500).describe("Starting location or city"),
  endLocation: z.string().max(500).optional().describe("Destination or end point"),
  scheduledAt: z.string().optional().describe("ISO date string for ride schedule"),
  experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"]).optional().describe("Experience level required"),
  pace: z.enum(["Leisurely", "Moderate", "Spirited"]).optional().describe("Pace of the ride"),
  maxParticipants: z.coerce.number().int().positive().max(100).optional().default(20),
  description: z.string().max(2000).optional(),
});

export async function createRideToolHandler(
  args: z.infer<typeof createRideInputSchema>,
  context: ToolContext
) {
  if (!context?.userId) {
    throw new Error("Unauthorized: Active user session is required to create a ride.");
  }

  const scheduledDate = args.scheduledAt
    ? new Date(args.scheduledAt)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(scheduledDate.getTime())) {
    throw new Error("scheduledAt must be a valid ISO date string.");
  }

  const ride = await prisma.ride.create({
    data: {
      creatorId: context.userId,
      title: args.title,
      startLocation: args.startLocation,
      endLocation: args.endLocation,
      description: args.description,
      scheduledAt: scheduledDate,
      experienceLevel: args.experienceLevel || "INTERMEDIATE",
      pace: args.pace || "Moderate",
      status: "PLANNED",
      keepPermanently: false,
    },
  });

  return {
    success: true,
    rideId: ride.id,
    title: ride.title,
    startLocation: ride.startLocation,
    endLocation: ride.endLocation,
    scheduledAt: ride.scheduledAt?.toISOString() ?? null,
    status: ride.status,
  };
}

export const searchRidesInputSchema = z.object({
  query: z.string().optional().describe("Search term for title, destination, or start location"),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "ALL"]).optional().default("PLANNED"),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

export async function searchRidesToolHandler(
  args: z.infer<typeof searchRidesInputSchema>,
  context: ToolContext
) {
  // Only PUBLIC rides, plus the caller's own, are discoverable. Friends-only and
  // incognito rides must never leak through the assistant.
  const where: any = {
    OR: [{ privacyLevel: "PUBLIC" }, { creatorId: context.userId }],
  };

  if (args.status && args.status !== "ALL") {
    where.status = args.status;
  }

  if (args.query && args.query.trim()) {
    const q = args.query.trim();
    where.AND = [
      {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { startLocation: { contains: q, mode: "insensitive" } },
          { endLocation: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
  }

  const rides = await prisma.ride.findMany({
    where,
    take: args.limit || 10,
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      title: true,
      startLocation: true,
      endLocation: true,
      scheduledAt: true,
      status: true,
      experienceLevel: true,
      pace: true,
      creator: { select: { id: true, name: true, username: true } },
    },
  });

  return {
    success: true,
    count: rides.length,
    rides: rides.map((r: any) => ({
      id: r.id,
      title: r.title,
      startLocation: r.startLocation,
      endLocation: r.endLocation,
      scheduledAt: r.scheduledAt?.toISOString() ?? null,
      creator: r.creator?.name || r.creator?.username || "Unknown",
    })),
  };
}

export const createRideTool: McpToolDefinition<typeof createRideInputSchema> = {
  name: "create_ride",
  description: "Create a new motorcycle group ride or solo ride for the authenticated user",
  schema: createRideInputSchema,
  handler: createRideToolHandler,
};

export const searchRidesTool: McpToolDefinition<typeof searchRidesInputSchema> = {
  name: "search_rides",
  description: "Search upcoming motorcycle rides by title, start location, destination, or status",
  schema: searchRidesInputSchema,
  handler: searchRidesToolHandler,
};
