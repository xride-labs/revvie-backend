import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRideToolHandler, searchRidesToolHandler } from "../tools/ride.tools.js";
import { prisma } from "../../lib/prisma.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    ride: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    participant: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  },
}));

describe("MCP Ride Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a ride enforcing context.userId as creatorId", async () => {
    const mockCreatedRide = {
      id: "ride-123",
      title: "Morning Nandi Ride",
      startLocation: "Indiranagar",
      endLocation: "Nandi Hills",
      scheduledAt: new Date("2026-10-15T06:00:00Z"),
      creatorId: "user-real-session-id",
      status: "PLANNED",
    };

    (prisma.ride.create as any).mockResolvedValue(mockCreatedRide);

    const context = { userId: "user-real-session-id" };
    const result = await createRideToolHandler(
      {
        title: "Morning Nandi Ride",
        startLocation: "Indiranagar",
        endLocation: "Nandi Hills",
        scheduledAt: "2026-10-15T06:00:00Z",
      },
      context
    );

    expect(result.success).toBe(true);
    expect(result.rideId).toBe("ride-123");
    expect(prisma.ride.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorId: "user-real-session-id",
          title: "Morning Nandi Ride",
        }),
      })
    );
  });

  it("rejects unauthorized execution if context.userId is missing", async () => {
    const context = { userId: "" };
    await expect(
      createRideToolHandler(
        {
          title: "Morning Nandi Ride",
          startLocation: "Indiranagar",
        },
        context
      )
    ).rejects.toThrow("Unauthorized");
  });

  it("searches rides matching query and status filter", async () => {
    const mockRides = [
      {
        id: "ride-1",
        title: "Western Ghats Tour",
        startLocation: "Bangalore",
        endLocation: "Coorg",
        scheduledAt: new Date("2026-10-20T06:00:00Z"),
        status: "PLANNED",
        creator: { id: "user-1", name: "Alice", username: "alice" },
      },
    ];

    (prisma.ride.findMany as any).mockResolvedValue(mockRides);

    const context = { userId: "user-real-session-id" };
    const result = await searchRidesToolHandler(
      { query: "Ghats", status: "PLANNED" },
      context
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.rides[0].title).toBe("Western Ghats Tour");
    expect(prisma.ride.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PLANNED",
        }),
      })
    );
  });
});
