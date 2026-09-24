/**
 * MEDIA ROUTES TESTS
 * Tests for media upload endpoints: profiles, clubs, rides, listings, posts
 */

import { vi } from "vitest";
import request from "supertest";
import { app } from "../../server";
import {
  createTestUser,
  createTestRide,
  createTestClub,
  createTestListing,
  cleanupTestData,
  assertValidSuccessResponse,
} from "../../test/utils";
import prisma from "../../lib/prisma.js";

// Replace the Cloudinary network calls with fakes so uploads/deletes are
// deterministic and offline. importActual keeps the real enums, the
// MediaValidationError class, and generateUploadSignature intact.
vi.mock("../../lib/cloudinary.js", async (importActual) => {
  const actual =
    await importActual<typeof import("../../lib/cloudinary.js")>();
  const fakeResult = {
    publicId: "test/fake-public-id",
    url: "http://res.cloudinary.com/test/image/upload/fake.png",
    secureUrl: "https://res.cloudinary.com/test/image/upload/fake.png",
    format: "png",
    bytes: 123,
    resourceType: "image",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const upload = vi.fn(async () => fakeResult);
  return {
    ...actual,
    uploadMedia: upload,
    uploadProfileImage: upload,
    uploadProfileCover: upload,
    uploadProfileGallery: upload,
    uploadBikeImage: upload,
    uploadClubLogo: upload,
    uploadClubCover: upload,
    uploadClubGallery: upload,
    uploadRideMedia: upload,
    uploadListingImage: upload,
    uploadListingMedia: upload,
    uploadPostMedia: upload,
    deleteMedia: vi.fn(async () => true),
    deleteMultipleMedia: vi.fn(async () => true),
  };
});

describe("Media Routes", () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe("POST /api/media/upload", () => {
    it("should upload profile image", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/media/upload")
        .set("Authorization", `Bearer ${token}`)
        .send({
          file: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          type: "image",
          folder: "profiles",
        });

      expect([200, 201]).toContain(res.status);
    });

    it("should upload club image", async () => {
      const { token, user } = await createTestUser();
      const club = await createTestClub(user.id);

      const res = await request(app)
        .post("/api/media/upload")
        .set("Authorization", `Bearer ${token}`)
        .send({
          file: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          type: "image",
          folder: "clubs",
          resourceId: club.id,
        });

      expect([200, 201]).toContain(res.status);
    });

    it("should upload ride image", async () => {
      const { token, user } = await createTestUser();
      const ride = await createTestRide(user.id);

      const res = await request(app)
        .post("/api/media/upload")
        .set("Authorization", `Bearer ${token}`)
        .send({
          file: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          type: "image",
          folder: "rides",
          resourceId: ride.id,
        });

      expect([200, 201]).toContain(res.status);
    });

    it("should upload listing image", async () => {
      const { token, user } = await createTestUser();
      const listing = await createTestListing(user.id);

      const res = await request(app)
        .post("/api/media/upload")
        .set("Authorization", `Bearer ${token}`)
        .send({
          file: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          type: "image",
          folder: "listings",
          resourceId: listing.id,
        });

      expect([200, 201]).toContain(res.status);
    });

    it("should upload business image", async () => {
      const { token, user } = await createTestUser();
      const business = await prisma.businessProfile.create({
        data: {
          ownerId: user.id,
          displayName: "Test Garage",
          slug: `test-garage-${Date.now()}`,
          categories: ["SERVICE_STORE"],
        },
      });

      const res = await request(app)
        .post("/api/media/upload")
        .set("Authorization", `Bearer ${token}`)
        .send({
          file: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          type: "image",
          folder: "businesses",
          resourceId: business.id,
        });

      expect([200, 201]).toContain(res.status);
    });

    it("should reject invalid file type", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/media/upload")
        .set("Authorization", `Bearer ${token}`)
        .send({
          file: "not-valid-base64",
          type: "profile",
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("should return 401 without auth", async () => {
      const res = await request(app)
        .post("/api/media/upload")
        .send({ file: "data", type: "profile" });

      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/media/:id", () => {
    it("should delete media", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .delete("/api/media/test-media-id")
        .set("Authorization", `Bearer ${token}`);

      expect([200, 204, 404]).toContain(res.status);
    });
  });
});
