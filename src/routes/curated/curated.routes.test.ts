import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../server.js";
import { createTestUser, cleanupTestData } from "../../test/utils.js";
import prisma from "../../lib/prisma.js";

describe("Curated Itineraries & Places Routes", () => {
  let testUser: any;
  let testItinerary: any;

  beforeAll(async () => {
    testUser = await createTestUser();
    testItinerary = await prisma.curatedItinerary.findFirst();
  });

  afterAll(async () => {
    if (testUser?.user?.id) {
      await prisma.rideParticipant.deleteMany({
        where: { userId: testUser.user.id }
      });
      await prisma.ride.deleteMany({
        where: { creatorId: testUser.user.id }
      });
      await cleanupTestData([testUser.user.id]);
    }
  });

  describe("GET /api/curated-itineraries", () => {
    it("returns paginated list of curated itineraries", async () => {
      const res = await request(app)
        .get("/api/curated-itineraries")
        .query({ page: 1, limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
    });

    it("filters itineraries by corridor", async () => {
      const res = await request(app)
        .get("/api/curated-itineraries")
        .query({ corridor: "MYSORE_ROAD" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      res.body.data.items.forEach((item: any) => {
        expect(item.corridor).toBe("MYSORE_ROAD");
      });
    });

    it("filters itineraries by duration tier", async () => {
      const res = await request(app)
        .get("/api/curated-itineraries")
        .query({ durationTier: "HALF_DAY" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      res.body.data.items.forEach((item: any) => {
        expect(item.durationTier).toBe("HALF_DAY");
      });
    });

    it("returns 400 for invalid durationTier enum", async () => {
      const res = await request(app)
        .get("/api/curated-itineraries")
        .query({ durationTier: "INVALID_TIER" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/curated-itineraries/:id", () => {
    it("returns full itinerary dossier with waypoints", async () => {
      if (!testItinerary) return;

      const res = await request(app)
        .get(`/api/curated-itineraries/${testItinerary.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(testItinerary.id);
      expect(Array.isArray(res.body.data.waypoints)).toBe(true);
    });

    it("returns 404 for non-existent itinerary id", async () => {
      const res = await request(app)
        .get("/api/curated-itineraries/non-existent-cuid-12345");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/curated-itineraries/:id/schedule", () => {
    it("rejects unauthorized scheduling attempt with 401", async () => {
      if (!testItinerary) return;

      const res = await request(app)
        .post(`/api/curated-itineraries/${testItinerary.id}/schedule`)
        .send({
          scheduledAt: new Date(Date.now() + 86400000).toISOString()
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("schedules an itinerary as an active user Ride with waypoints", async () => {
      if (!testItinerary || !testUser) return;

      const schedulePayload = {
        scheduledAt: new Date(Date.now() + 172800000).toISOString(),
        title: "My Custom Navadurga Weekend Ride",
        pace: "Moderate",
        experienceLevel: "Intermediate",
        isPrivate: false
      };

      const res = await testUser
        .post(`/api/curated-itineraries/${testItinerary.id}/schedule`)
        .send(schedulePayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.curatedItineraryId).toBe(testItinerary.id);
      expect(res.body.data.title).toBe(schedulePayload.title);
      expect(res.body.data.status).toBe("PLANNED");
      expect(res.body.data.creatorId).toBe(testUser.user.id);
      expect(Array.isArray(res.body.data.waypoints)).toBe(true);

      // Verify ride participant role LEADER
      const participant = await prisma.rideParticipant.findFirst({
        where: {
          rideId: res.body.data.id,
          userId: testUser.user.id
        }
      });
      expect(participant).toBeDefined();
      expect(participant?.status).toBe("ACCEPTED");
    });
  });

  describe("GET /api/curated-itineraries/places/curated", () => {
    it("returns ranked curated places", async () => {
      const res = await request(app)
        .get("/api/curated-itineraries/places/curated")
        .query({ corridor: "KANAKAPURA_ROAD" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      res.body.data.items.forEach((p: any) => {
        expect(p.corridor).toBe("KANAKAPURA_ROAD");
      });
    });
  });
});
