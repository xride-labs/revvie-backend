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
  cleanupTestData,
} from "../../test/utils";

// A well-formed (cuid-length) id that does not exist → real 404.
const NONEXISTENT_ID = "clnonexistent000000000001";

describe("Public Routes", () => {
  afterEach(async () => {
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
    it("should return a curated preview list WITHOUT an auth header", async () => {
      const { user } = await createTestUser();
      const listing = await createTestListing(user.id, {
        title: "Used Helmet",
        price: 150,
        currency: "INR",
        condition: "Good",
        category: "Gear",
        images: ["https://cdn.example.com/helmet.jpg"],
      });

      const res = await request(app).get("/api/public/marketplace");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.listings).toContainEqual({
        id: listing.id,
        title: "Used Helmet",
        price: 150,
        currency: "INR",
        condition: "Good",
        image: "https://cdn.example.com/helmet.jpg",
        category: "Gear",
        featured: false,
        seller: { id: user.id, name: user.name, avatar: user.avatar ?? null },
        club: null,
        rating: null,
        ratingCount: 0,
      });
    });

    it("should not leak sellerId/coords/description", async () => {
      const { user } = await createTestUser();
      await createTestListing(user.id);

      const res = await request(app).get("/api/public/marketplace");

      expect(res.status).toBe(200);
      const keys = Object.keys(res.body.data.listings[0]).sort();
      expect(keys).toEqual(
        [
          "category",
          "club",
          "condition",
          "currency",
          "featured",
          "id",
          "image",
          "price",
          "rating",
          "ratingCount",
          "seller",
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
    it("should return a curated listing preview WITHOUT an auth header", async () => {
      const { user } = await createTestUser();
      const listing = await createTestListing(user.id, {
        title: "Used Helmet",
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
        price: 150,
        currency: listing.currency,
        condition: "Good",
        image: "https://cdn.example.com/helmet.jpg",
        category: "Gear",
        status: listing.status,
      });
    });

    it("should expose only curated fields and not leak sellerId/coords", async () => {
      const { user } = await createTestUser();
      const listing = await createTestListing(user.id);

      const res = await request(app).get(
        `/api/public/marketplace/${listing.id}`,
      );

      expect(res.status).toBe(200);
      const keys = Object.keys(res.body.data).sort();
      expect(keys).toEqual(
        [
          "category",
          "condition",
          "currency",
          "id",
          "image",
          "price",
          "status",
          "title",
        ].sort(),
      );
      expect(res.body.data).not.toHaveProperty("sellerId");
      expect(res.body.data).not.toHaveProperty("description");
      expect(res.body.data).not.toHaveProperty("latitude");
      expect(res.body.data).not.toHaveProperty("longitude");
    });

    it("should default image to null when the listing has no images", async () => {
      const { user } = await createTestUser();
      const listing = await createTestListing(user.id, { images: [] });

      const res = await request(app).get(
        `/api/public/marketplace/${listing.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.image).toBeNull();
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
});
