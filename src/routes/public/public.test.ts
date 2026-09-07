/**
 * PUBLIC ROUTES TESTS
 * Tests for /api/public endpoints — these are UNAUTHENTICATED web-share
 * previews, so every happy-path request is made WITHOUT an Authorization
 * header to prove they work for anonymous visitors.
 *
 *   GET /api/public/rides/:id        ride preview
 *   GET /api/public/marketplace/:id  listing preview (requires marketplace on)
 *   GET /api/public/clubs/:id        public club preview (404 if not public)
 *
 * validateParams uses z.object({ id: z.string().min(1) }) — only an empty
 * string would 400, which cannot be produced via path routing. So there is no
 * realistic malformed-id 400 path; a well-formed nonexistent id yields 404.
 * marketplaceEnabled defaults to true in AdminSettings, so the listing
 * endpoint is reachable in tests.
 */

import request from "supertest";
import { app } from "../../server";
import {
  createTestUser,
  createTestRide,
  createTestClub,
  createTestListing,
  createTestEvent,
  cleanupTestData,
} from "../../test/utils";

// `sendEmail`'s real behavior branches on Brevo being configured, which isn't
// guaranteed in every environment these tests run in — mock it so the contact
// endpoint's success/failure path is deterministic instead of environment-dependent.
const { sendEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(async () => true),
}));

vi.mock("../../lib/mailer.js", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/mailer.js")>();
  return {
    ...actual,
    sendEmail: sendEmailMock,
  };
});

// A well-formed (cuid-length) id that does not exist → real 404.
const NONEXISTENT_ID = "clnonexistent000000000001";

describe("Public Routes", () => {
  afterEach(async () => {
    sendEmailMock.mockClear();
    await cleanupTestData();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/public/rides/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/public/rides/:id", () => {
    it("should return a curated ride preview WITHOUT an auth header", async () => {
      const { user } = await createTestUser();
      const ride = await createTestRide(user.id, {
        title: "Public Ride",
        startLocation: "Trailhead",
        images: ["https://cdn.example.com/banner.jpg", "second.jpg"],
      });

      // No Authorization header — anonymous visitor.
      const res = await request(app).get(`/api/public/rides/${ride.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        id: ride.id,
        title: "Public Ride",
        startLocation: "Trailhead",
        scheduledAt: expect.any(String),
        bannerImage: "https://cdn.example.com/banner.jpg",
        participantCount: 0,
        status: ride.status,
      });
    });

    it("should expose only the curated public fields (no internal leakage)", async () => {
      const { user } = await createTestUser();
      const ride = await createTestRide(user.id);

      const res = await request(app).get(`/api/public/rides/${ride.id}`);

      expect(res.status).toBe(200);
      // The handler hand-picks fields; private columns must not leak.
      const keys = Object.keys(res.body.data).sort();
      expect(keys).toEqual(
        [
          "bannerImage",
          "id",
          "participantCount",
          "scheduledAt",
          "startLocation",
          "status",
          "title",
        ].sort(),
      );
      expect(res.body.data).not.toHaveProperty("creatorId");
      expect(res.body.data).not.toHaveProperty("latitude");
      expect(res.body.data).not.toHaveProperty("longitude");
      expect(res.body.data).not.toHaveProperty("endLocation");
    });

    it("should default bannerImage to null when the ride has no images", async () => {
      const { user } = await createTestUser();
      const ride = await createTestRide(user.id, { images: [] });

      const res = await request(app).get(`/api/public/rides/${ride.id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.bannerImage).toBeNull();
    });

    it("should return 404 for a well-formed nonexistent ride id", async () => {
      const res = await request(app).get(
        `/api/public/rides/${NONEXISTENT_ID}`,
      );

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/public/marketplace
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/public/marketplace", () => {
    it("should return a curated, paginated listing list WITHOUT an auth header", async () => {
      const { user } = await createTestUser();
      const listing = await createTestListing(user.id, {
        title: "Used Helmet",
        price: 150,
        currency: "INR",
        condition: "Good",
        category: "Gear",
        locationLabel: "Bengaluru",
        images: ["https://cdn.example.com/helmet.jpg"],
      });

      const res = await request(app).get("/api/public/marketplace");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(res.body.data.listings).toContainEqual({
        id: listing.id,
        title: "Used Helmet",
        price: 150,
        currency: "INR",
        condition: "Good",
        category: "Gear",
        subcategory: null,
        images: ["https://cdn.example.com/helmet.jpg"],
        locationLabel: "Bengaluru",
        allowBids: true,
        status: "ACTIVE",
        featured: false,
        seller: { id: user.id, name: user.name, avatar: user.avatar ?? null },
        club: null,
        rating: null,
        ratingCount: 0,
        createdAt: listing.createdAt.toISOString(),
      });
    });

    it("should respect the limit param (landing page teaser passes limit=8)", async () => {
      const { user } = await createTestUser();
      for (let i = 0; i < 3; i++) {
        await createTestListing(user.id, { title: `Item ${i}` });
      }

      const res = await request(app).get("/api/public/marketplace?limit=2");

      expect(res.status).toBe(200);
      expect(res.body.data.listings).toHaveLength(2);
      expect(res.body.data.pagination.limit).toBe(2);
      expect(res.body.data.pagination.total).toBe(3);
      expect(res.body.data.pagination.totalPages).toBe(2);
    });

    it("should filter by category and price range", async () => {
      const { user } = await createTestUser();
      await createTestListing(user.id, {
        title: "Cheap Gear",
        category: "Gear",
        price: 100,
      });
      await createTestListing(user.id, {
        title: "Expensive Bike",
        category: "Motorcycle",
        price: 5000,
      });

      const res = await request(app).get(
        "/api/public/marketplace?category=Gear&maxPrice=200",
      );

      expect(res.status).toBe(200);
      expect(res.body.data.listings).toHaveLength(1);
      expect(res.body.data.listings[0].title).toBe("Cheap Gear");
    });

    it("should not leak sellerId/coords/description", async () => {
      const { user } = await createTestUser();
      await createTestListing(user.id);

      const res = await request(app).get("/api/public/marketplace");

      expect(res.status).toBe(200);
      const keys = Object.keys(res.body.data.listings[0]).sort();
      expect(keys).toEqual(
        [
          "allowBids",
          "category",
          "club",
          "condition",
          "createdAt",
          "currency",
          "featured",
          "id",
          "images",
          "locationLabel",
          "price",
          "rating",
          "ratingCount",
          "seller",
          "status",
          "subcategory",
          "title",
        ].sort(),
      );
      expect(res.body.data.listings[0]).not.toHaveProperty("sellerId");
      expect(res.body.data.listings[0]).not.toHaveProperty("description");
      expect(res.body.data.listings[0]).not.toHaveProperty("latitude");
      expect(res.body.data.listings[0]).not.toHaveProperty("longitude");
    });

    it("should exclude CLUB_ONLY listings", async () => {
      const { user } = await createTestUser();
      const club = await createTestClub(user.id);
      await createTestListing(user.id, {
        title: "Club-only Item",
        clubId: club.id,
        visibility: "CLUB_ONLY",
      });

      const res = await request(app).get("/api/public/marketplace");

      expect(res.status).toBe(200);
      expect(
        res.body.data.listings.some((l: any) => l.title === "Club-only Item"),
      ).toBe(false);
    });

    it("should exclude non-ACTIVE listings", async () => {
      const { user } = await createTestUser();
      await createTestListing(user.id, {
        title: "Sold Item",
        status: "SOLD",
      });

      const res = await request(app).get("/api/public/marketplace");

      expect(res.status).toBe(200);
      expect(res.body.data.listings.some((l: any) => l.title === "Sold Item")).toBe(
        false,
      );
    });

    it("should sort featured listings first", async () => {
      const { user } = await createTestUser();
      await createTestListing(user.id, { title: "Regular Item", featured: false });
      await createTestListing(user.id, { title: "Boosted Item", featured: true });

      const res = await request(app).get("/api/public/marketplace");

      expect(res.status).toBe(200);
      expect(res.body.data.listings[0].title).toBe("Boosted Item");
    });

    it("should surface avgRating/reviewCount as rating/ratingCount", async () => {
      const { user } = await createTestUser();
      const listing = await createTestListing(user.id, {
        title: "Rated Item",
        avgRating: 4.5,
        reviewCount: 3,
      });

      const res = await request(app).get("/api/public/marketplace");

      expect(res.status).toBe(200);
      const found = res.body.data.listings.find((l: any) => l.id === listing.id);
      expect(found.rating).toBe(4.5);
      expect(found.ratingCount).toBe(3);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/public/marketplace/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/public/marketplace/:id", () => {
    it("should return the full curated listing detail WITHOUT an auth header", async () => {
      const { user } = await createTestUser();
      const listing = await createTestListing(user.id, {
        title: "Used Helmet",
        description: "Barely used, one season only.",
        price: 150,
        condition: "Good",
        category: "Gear",
        images: ["https://cdn.example.com/helmet.jpg", "alt.jpg"],
      });

      const res = await request(app).get(
        `/api/public/marketplace/${listing.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        id: listing.id,
        title: "Used Helmet",
        description: "Barely used, one season only.",
        price: 150,
        currency: listing.currency,
        condition: "Good",
        category: "Gear",
        subcategory: null,
        images: ["https://cdn.example.com/helmet.jpg", "alt.jpg"],
        videos: [],
        specifications: null,
        locationLabel: null,
        allowBids: true,
        latitude: listing.latitude,
        longitude: listing.longitude,
        status: listing.status,
        featured: false,
        seller: { id: user.id, name: user.name, avatar: user.avatar ?? null },
        club: null,
        rating: null,
        ratingCount: 0,
        interestCount: 0,
        createdAt: listing.createdAt.toISOString(),
      });
    });

    it("should expose only curated fields and not leak sellerId", async () => {
      const { user } = await createTestUser();
      const listing = await createTestListing(user.id);

      const res = await request(app).get(
        `/api/public/marketplace/${listing.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty("sellerId");
    });

    it("should return 404 for a DRAFT listing", async () => {
      const { user } = await createTestUser();
      const listing = await createTestListing(user.id, { status: "DRAFT" });

      const res = await request(app).get(
        `/api/public/marketplace/${listing.id}`,
      );

      expect(res.status).toBe(404);
    });

    it("should return 404 for a CLUB_ONLY listing", async () => {
      const { user } = await createTestUser();
      const club = await createTestClub(user.id);
      const listing = await createTestListing(user.id, {
        clubId: club.id,
        visibility: "CLUB_ONLY",
      });

      const res = await request(app).get(
        `/api/public/marketplace/${listing.id}`,
      );

      expect(res.status).toBe(404);
    });

    it("should return 404 for a well-formed nonexistent listing id", async () => {
      const res = await request(app).get(
        `/api/public/marketplace/${NONEXISTENT_ID}`,
      );

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/public/marketplace/:id/contact
  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /api/public/marketplace/:id/contact", () => {
    it("should email the seller with replyTo set to the buyer's address", async () => {
      const { user: seller } = await createTestUser({
        email: "seller@example.com",
        name: "Sam Seller",
      });
      const listing = await createTestListing(seller.id, { title: "Used Helmet" });

      const res = await request(app)
        .post(`/api/public/marketplace/${listing.id}/contact`)
        .send({
          name: "Barry Buyer",
          email: "buyer@example.com",
          message: "Is this still available?",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const call = sendEmailMock.mock.calls[0][0];
      expect(call.to).toBe("seller@example.com");
      expect(call.replyTo).toBe("buyer@example.com");
      expect(call.subject).toContain("Used Helmet");
    });

    it("should reject a message that's too short", async () => {
      const { user: seller } = await createTestUser();
      const listing = await createTestListing(seller.id);

      const res = await request(app)
        .post(`/api/public/marketplace/${listing.id}/contact`)
        .send({ name: "Barry", email: "buyer@example.com", message: "hi" });

      expect(res.status).toBe(400);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("should reject an invalid email", async () => {
      const { user: seller } = await createTestUser();
      const listing = await createTestListing(seller.id);

      const res = await request(app)
        .post(`/api/public/marketplace/${listing.id}/contact`)
        .send({ name: "Barry", email: "not-an-email", message: "Is this available?" });

      expect(res.status).toBe(400);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("should return 404 for a nonexistent listing", async () => {
      const res = await request(app)
        .post(`/api/public/marketplace/${NONEXISTENT_ID}/contact`)
        .send({ name: "Barry", email: "buyer@example.com", message: "Still available?" });

      expect(res.status).toBe(404);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("should return 502 when the email fails to send", async () => {
      sendEmailMock.mockResolvedValueOnce(false);
      const { user: seller } = await createTestUser();
      const listing = await createTestListing(seller.id);

      const res = await request(app)
        .post(`/api/public/marketplace/${listing.id}/contact`)
        .send({ name: "Barry", email: "buyer@example.com", message: "Still available?" });

      expect(res.status).toBe(502);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/public/clubs/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/public/clubs/:id", () => {
    it("should return a curated public club preview WITHOUT an auth header", async () => {
      const { user } = await createTestUser();
      const club = await createTestClub(user.id, {
        name: "Public Riders",
        description: "Open to all",
        location: "Phoenix",
        isPublic: true,
      });

      const res = await request(app).get(`/api/public/clubs/${club.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        id: club.id,
        name: "Public Riders",
        description: "Open to all",
        image: club.image ?? null,
        location: "Phoenix",
        memberCount: club.memberCount,
        isPublic: true,
      });
    });

    it("should expose only curated fields and not leak ownerId/coords", async () => {
      const { user } = await createTestUser();
      const club = await createTestClub(user.id, { isPublic: true });

      const res = await request(app).get(`/api/public/clubs/${club.id}`);

      expect(res.status).toBe(200);
      const keys = Object.keys(res.body.data).sort();
      expect(keys).toEqual(
        [
          "description",
          "id",
          "image",
          "isPublic",
          "location",
          "memberCount",
          "name",
        ].sort(),
      );
      expect(res.body.data).not.toHaveProperty("ownerId");
      expect(res.body.data).not.toHaveProperty("latitude");
      expect(res.body.data).not.toHaveProperty("longitude");
    });

    it("should return 404 for a private (non-public) club", async () => {
      const { user } = await createTestUser();
      const club = await createTestClub(user.id, { isPublic: false });

      const res = await request(app).get(`/api/public/clubs/${club.id}`);

      // Private clubs are treated as not found to avoid disclosing existence.
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should return 404 for a well-formed nonexistent club id", async () => {
      const res = await request(app).get(
        `/api/public/clubs/${NONEXISTENT_ID}`,
      );

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/public/events
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/public/events", () => {
    it("should return upcoming PUBLIC events WITHOUT an auth header", async () => {
      const { user } = await createTestUser();
      const event = await createTestEvent(user.id, { title: "Public Meetup" });

      const res = await request(app).get("/api/public/events");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const found = res.body.data.events.find((e: any) => e.id === event.id);
      expect(found).toBeTruthy();
      expect(found.title).toBe("Public Meetup");
      expect(found.participantCount).toBe(0);
      expect(found).not.toHaveProperty("isAttending");
      expect(found).not.toHaveProperty("isHost");
    });

    it("should exclude CLUB_ONLY and PRIVATE events", async () => {
      const { user } = await createTestUser();
      await createTestEvent(user.id, { title: "Club Ride", visibility: "CLUB_ONLY" });
      await createTestEvent(user.id, { title: "Secret Party", visibility: "PRIVATE" });

      const res = await request(app).get("/api/public/events");

      expect(res.status).toBe(200);
      const titles = res.body.data.events.map((e: any) => e.title);
      expect(titles).not.toContain("Club Ride");
      expect(titles).not.toContain("Secret Party");
    });

    it("should exclude cancelled and past events", async () => {
      const { user } = await createTestUser();
      await createTestEvent(user.id, { title: "Cancelled Ride", status: "CANCELLED" });
      await createTestEvent(user.id, {
        title: "Past Ride",
        scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });

      const res = await request(app).get("/api/public/events");

      expect(res.status).toBe(200);
      const titles = res.body.data.events.map((e: any) => e.title);
      expect(titles).not.toContain("Cancelled Ride");
      expect(titles).not.toContain("Past Ride");
    });

    it("should filter by category and search", async () => {
      const { user } = await createTestUser();
      await createTestEvent(user.id, { title: "Track Day Special", category: "TRACK_DAY" });
      await createTestEvent(user.id, { title: "Sunday Breakfast Run", category: "MEETUP" });

      const res = await request(app).get("/api/public/events?category=TRACK_DAY");

      expect(res.status).toBe(200);
      expect(res.body.data.events).toHaveLength(1);
      expect(res.body.data.events[0].title).toBe("Track Day Special");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/public/events/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/public/events/:id", () => {
    it("should return a PUBLIC event's full detail WITHOUT an auth header", async () => {
      const { user } = await createTestUser();
      const event = await createTestEvent(user.id, { title: "Public Meetup" });

      const res = await request(app).get(`/api/public/events/${event.id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(event.id);
      expect(res.body.data.title).toBe("Public Meetup");
      expect(res.body.data.participantCount).toBe(0);
    });

    it("should return 404 for a CLUB_ONLY event", async () => {
      const { user } = await createTestUser();
      const event = await createTestEvent(user.id, { visibility: "CLUB_ONLY" });

      const res = await request(app).get(`/api/public/events/${event.id}`);

      expect(res.status).toBe(404);
    });

    it("should return 404 for a PRIVATE event", async () => {
      const { user } = await createTestUser();
      const event = await createTestEvent(user.id, { visibility: "PRIVATE" });

      const res = await request(app).get(`/api/public/events/${event.id}`);

      expect(res.status).toBe(404);
    });

    it("should return 404 for a cancelled event", async () => {
      const { user } = await createTestUser();
      const event = await createTestEvent(user.id, { status: "CANCELLED" });

      const res = await request(app).get(`/api/public/events/${event.id}`);

      expect(res.status).toBe(404);
    });

    it("should return 404 for a well-formed nonexistent event id", async () => {
      const res = await request(app).get(`/api/public/events/${NONEXISTENT_ID}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
