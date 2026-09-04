/**
 * EVENT ROUTES TESTS
 * Tests for event discovery, hosting, and attendance.
 *
 * Routes (all behind requireAuth):
 *   GET  /api/events                 -> ApiResponse.success({ events[], total, page, totalPages, hasMore }, ...)
 *   POST /api/events                 -> ApiResponse.created(event, ...) | 403 (club gating)
 *   POST /api/events/:id/attend      -> ApiResponse.success(participation, ...) | 404
 */

import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma";
import {
  createTestUser,
  createAdminUser,
  createTestClub,
  cleanupTestData,
} from "../../test/utils";

// ─── Local data helpers ──────────────────────────────────────────────────────

async function createEvent(creatorId: string, overrides: Partial<any> = {}) {
  return prisma.event.create({
    data: {
      title: "Test Event",
      scheduledAt: new Date(Date.now() + 7 * 86400000), // next week
      creatorId,
      ...overrides,
    },
  });
}

function futureIso(daysAhead = 7) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString();
}

describe("Event Routes", () => {
  afterEach(async () => {
    // Children before parents: participants -> events. Clubs/users handled by
    // cleanupTestData (events reference both via cascade-safe order here).
    await prisma.eventParticipant.deleteMany({});
    await prisma.event.deleteMany({});
    await cleanupTestData();
  });

  // ─── GET /api/events ─────────────────────────────────────────────────────────
  describe("GET /api/events", () => {
    it("should list upcoming events with participant counts (happy path)", async () => {
      const { user, token } = await createTestUser();
      const event = await createEvent(user.id, { title: "Sunday Ride Meetup" });

      const res = await request(app)
        .get("/api/events")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // ApiResponse.success({ events, total, page, totalPages, hasMore }, ...)
      expect(Array.isArray(res.body.data.events)).toBe(true);
      const served = res.body.data.events.find((e: any) => e.id === event.id);
      expect(served).toBeTruthy();
      expect(served.title).toBe("Sunday Ride Meetup");
      expect(served._count).toHaveProperty("participants");
      expect(served.creator).toMatchObject({ id: user.id });
    });

    it("should exclude past and CANCELLED events", async () => {
      const { user, token } = await createTestUser();
      const past = await createEvent(user.id, {
        scheduledAt: new Date(Date.now() - 86400000),
      });
      const cancelled = await createEvent(user.id, { status: "CANCELLED" });

      const res = await request(app)
        .get("/api/events")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.events.map((e: any) => e.id);
      expect(ids).not.toContain(past.id);
      expect(ids).not.toContain(cancelled.id);
    });

    it("should filter by isFeatured=true", async () => {
      const { user, token } = await createTestUser();
      const featured = await createEvent(user.id, { isFeatured: true });
      const normal = await createEvent(user.id, { isFeatured: false });

      const res = await request(app)
        .get("/api/events?isFeatured=true")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.events.map((e: any) => e.id);
      expect(ids).toContain(featured.id);
      expect(ids).not.toContain(normal.id);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).get("/api/events");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── POST /api/events ────────────────────────────────────────────────────────
  describe("POST /api/events", () => {
    it("should create a standalone event (201 + DB side-effect)", async () => {
      const { user, token } = await createTestUser();

      const res = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${token}`)
        .send({
          title: "Coastal Cruise",
          description: "A scenic group ride",
          location: "Pacific Coast Hwy",
          scheduledAt: futureIso(),
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe("Coastal Cruise");
      expect(res.body.data.creatorId).toBe(user.id);

      const inDb = await prisma.event.findUnique({
        where: { id: res.body.data.id },
      });
      expect(inDb).toBeTruthy();
      expect(inDb?.creatorId).toBe(user.id);
    });

    it("should return 400 when title is too short", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "ab", scheduledAt: futureIso() });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 when scheduledAt is missing", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "No Date Event" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 when scheduledAt is not a valid datetime", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "Bad Date Event", scheduledAt: "not-a-date" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 403 when a non-owner/non-staff hosts a club event", async () => {
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);
      // A different, non-member, non-staff user tries to host for the club.
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${token}`)
        .send({
          title: "Unauthorized Club Event",
          scheduledAt: futureIso(),
          clubId: club.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("should allow the club owner to host a club event (201)", async () => {
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);

      const res = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${owner.token}`)
        .send({
          title: "Owner Hosted Club Event",
          scheduledAt: futureIso(),
          clubId: club.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.clubId).toBe(club.id);
      expect(res.body.data.creatorId).toBe(owner.user.id);
    });

    it("should allow platform staff (ADMIN) to host a club event (201)", async () => {
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);
      const admin = await createAdminUser();

      const res = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({
          title: "Admin Hosted Club Event",
          scheduledAt: futureIso(),
          clubId: club.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.clubId).toBe(club.id);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app)
        .post("/api/events")
        .send({ title: "No Auth Event", scheduledAt: futureIso() });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── POST /api/events/:id/attend ─────────────────────────────────────────────
  describe("POST /api/events/:id/attend", () => {
    it("should join an event and create a participant (DB side-effect)", async () => {
      const creator = await createTestUser();
      const event = await createEvent(creator.user.id);
      const { user, token } = await createTestUser();

      const res = await request(app)
        .post(`/api/events/${event.id}/attend`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("ACCEPTED");

      const participation = await prisma.eventParticipant.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: user.id } },
      });
      expect(participation).toBeTruthy();
      expect(participation?.status).toBe("ACCEPTED");
    });

    it("should be idempotent on re-attend (upsert, no duplicate)", async () => {
      const creator = await createTestUser();
      const event = await createEvent(creator.user.id);
      const { user, token } = await createTestUser();

      await request(app)
        .post(`/api/events/${event.id}/attend`)
        .set("Authorization", `Bearer ${token}`);
      const res2 = await request(app)
        .post(`/api/events/${event.id}/attend`)
        .set("Authorization", `Bearer ${token}`);

      expect(res2.status).toBe(200);
      const count = await prisma.eventParticipant.count({
        where: { eventId: event.id, userId: user.id },
      });
      expect(count).toBe(1);
    });

    it("should return 404 for a valid-but-nonexistent event id", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/events/clnonexistent000000000000/attend")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 for a malformed (non-cuid) event id", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/events/not-a-cuid/attend")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).post(
        "/api/events/clnonexistent000000000000/attend",
      );

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── POST /api/events/:id/book (TICKETING & BOOKING) ─────────────────────────
  describe("POST /api/events/:id/book", () => {
    it("should book tickets, create order with commission, and generate unique passes", async () => {
      const host = await createTestUser();
      const buyer = await createTestUser();

      // Create event with tiers
      const eventRes = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${host.token}`)
        .send({
          title: "Monsoon Superbike Rally",
          scheduledAt: futureIso(),
          tiers: [
            { name: "General Pass", price: 500, quantity: 100, maxPerUser: 5 },
            { name: "VIP Track Pass", price: 1500, quantity: 20, maxPerUser: 2 },
          ],
        });

      expect(eventRes.status).toBe(201);
      const eventId = eventRes.body.data.id;

      // Fetch event to get tier id
      const detailRes = await request(app)
        .get(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${buyer.token}`);
      const vipTier = detailRes.body.data.ticketTiers.find((t: any) => t.name === "VIP Track Pass");

      // Book 2 VIP tickets with UPI
      const bookRes = await request(app)
        .post(`/api/events/${eventId}/book`)
        .set("Authorization", `Bearer ${buyer.token}`)
        .send({
          tierId: vipTier.id,
          quantity: 2,
          paymentMethod: "UPI",
          upiTransactionRef: "UPI-TEST-998822",
        });

      expect(bookRes.status).toBe(201);
      expect(bookRes.body.success).toBe(true);
      expect(bookRes.body.data.order).toMatchObject({
        totalAmount: 3000,
        commissionRate: 0.035,
        platformFee: 105,
        organiserEarnings: 2895,
        paymentMethod: "UPI",
        paymentStatus: "COMPLETED",
      });
      expect(bookRes.body.data.tickets.length).toBe(2);
      expect(bookRes.body.data.tickets[0].ticketCode).toMatch(/^TKT-REV-/);

      // Verify inventory decremented
      const updatedTier = await prisma.eventTicketTier.findUnique({ where: { id: vipTier.id } });
      expect(updatedTier?.availableQuantity).toBe(18);
    });

    it("should reject booking when quantity exceeds available inventory", async () => {
      const host = await createTestUser();
      const buyer = await createTestUser();

      const eventRes = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${host.token}`)
        .send({
          title: "Limited Track Session",
          scheduledAt: futureIso(),
          tiers: [{ name: "Exclusive Pass", price: 2000, quantity: 1 }],
        });

      const eventId = eventRes.body.data.id;
      const detailRes = await request(app)
        .get(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${buyer.token}`);
      const tier = detailRes.body.data.ticketTiers[0];

      // Attempt to buy 2 tickets when only 1 is available
      const bookRes = await request(app)
        .post(`/api/events/${eventId}/book`)
        .set("Authorization", `Bearer ${buyer.token}`)
        .send({
          tierId: tier.id,
          quantity: 2,
          paymentMethod: "UPI",
        });

      expect(bookRes.status).toBe(400);
      expect(bookRes.body.success).toBe(false);
    });
  });

  // ─── POST /api/events/:id/validate-ticket (GATE SCANNER) ──────────────────────
  describe("POST /api/events/:id/validate-ticket", () => {
    it("should validate a valid ticket and prevent duplicate scans", async () => {
      const host = await createTestUser();
      const attendee = await createTestUser();

      // Create event & book a pass
      const eventRes = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${host.token}`)
        .send({
          title: "Gate Check Event",
          scheduledAt: futureIso(),
          price: 0,
        });
      const eventId = eventRes.body.data.id;

      const bookRes = await request(app)
        .post(`/api/events/${eventId}/book`)
        .set("Authorization", `Bearer ${attendee.token}`)
        .send({ quantity: 1, paymentMethod: "FREE" });

      const ticketCode = bookRes.body.data.tickets[0].ticketCode;

      // 1. First Scan (Valid entry)
      const scan1 = await request(app)
        .post(`/api/events/${eventId}/validate-ticket`)
        .set("Authorization", `Bearer ${host.token}`)
        .send({ ticketCode });

      expect(scan1.status).toBe(200);
      expect(scan1.body.data.valid).toBe(true);
      expect(scan1.body.data.alreadyUsed).toBe(false);
      expect(scan1.body.data.attendee.id).toBe(attendee.user.id);

      // 2. Second Scan (Duplicate / already used warning)
      const scan2 = await request(app)
        .post(`/api/events/${eventId}/validate-ticket`)
        .set("Authorization", `Bearer ${host.token}`)
        .send({ ticketCode });

      expect(scan2.status).toBe(200);
      expect(scan2.body.data.valid).toBe(false);
      expect(scan2.body.data.alreadyUsed).toBe(true);
      expect(scan2.body.data.scannedAt).toBeTruthy();
    });

    it("should reject non-hosts or unauthorized users from validating tickets", async () => {
      const host = await createTestUser();
      const hacker = await createTestUser();

      const eventRes = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${host.token}`)
        .send({ title: "Secure Event", scheduledAt: futureIso() });
      const eventId = eventRes.body.data.id;

      const scan = await request(app)
        .post(`/api/events/${eventId}/validate-ticket`)
        .set("Authorization", `Bearer ${hacker.token}`)
        .send({ ticketCode: "TKT-REV-1234-5678" });

      expect(scan.status).toBe(403);
    });
  });

  // ─── GET /api/events/my-tickets & GET /api/events/:id/metrics ────────────────
  describe("Pass Wallet & Organiser Metrics", () => {
    it("should return user tickets in pass wallet and organiser sales metrics", async () => {
      const host = await createTestUser();
      const rider = await createTestUser();

      const eventRes = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${host.token}`)
        .send({
          title: "Sunday Track Meet",
          scheduledAt: futureIso(),
          tiers: [{ name: "Rider Pass", price: 1000, quantity: 50 }],
        });
      const eventId = eventRes.body.data.id;

      await request(app)
        .post(`/api/events/${eventId}/book`)
        .set("Authorization", `Bearer ${rider.token}`)
        .send({ quantity: 1, paymentMethod: "UPI" });

      // Check rider wallet
      const walletRes = await request(app)
        .get("/api/events/my-tickets")
        .set("Authorization", `Bearer ${rider.token}`);

      expect(walletRes.status).toBe(200);
      expect(walletRes.body.data.length).toBeGreaterThanOrEqual(1);
      expect(walletRes.body.data[0].event.id).toBe(eventId);

      // Check organiser metrics
      const metricsRes = await request(app)
        .get(`/api/events/${eventId}/metrics`)
        .set("Authorization", `Bearer ${host.token}`);

      expect(metricsRes.status).toBe(200);
      expect(metricsRes.body.data.totalTicketsSold).toBe(1);
      expect(metricsRes.body.data.grossRevenue).toBe(1000);
      expect(metricsRes.body.data.platformFee).toBe(35);
      expect(metricsRes.body.data.netOrganiserEarnings).toBe(965);
    });
  });
});
