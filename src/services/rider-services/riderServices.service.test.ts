import { afterEach, describe, expect, it } from "vitest";
import prisma from "../../lib/prisma.js";
import { cleanupTestData, createTestUser } from "../../test/utils.js";
import { getNearbyRiderServices } from "./riderServices.service.js";

let sequence = 0;

async function createBusiness(
  ownerId: string,
  overrides: Record<string, unknown> = {},
) {
  sequence += 1;
  return prisma.businessProfile.create({
    data: {
      ownerId,
      categories: ["MECHANIC"],
      displayName: `Rider Service ${sequence}`,
      slug: `rider-service-${Date.now()}-${sequence}`,
      verification: "APPROVED",
      latitude: 12.9716,
      longitude: 77.5946,
      ...overrides,
    },
  });
}

afterEach(async () => {
  await prisma.businessProfile.deleteMany({});
  await cleanupTestData();
});

describe("getNearbyRiderServices", () => {
  it("returns approved matching services inside the radius ordered by distance", async () => {
    const { user } = await createTestUser();
    const closest = await createBusiness(user.id, {
      displayName: "Close mechanic",
      latitude: 12.9720,
      longitude: 77.5948,
    });
    const farther = await createBusiness(user.id, {
      displayName: "Farther mechanic",
      latitude: 12.9900,
      longitude: 77.6100,
    });
    await createBusiness(user.id, {
      displayName: "Unapproved mechanic",
      verification: "PENDING",
    });
    await createBusiness(user.id, {
      displayName: "Outside radius mechanic",
      latitude: 13.2000,
      longitude: 77.6000,
    });
    await createBusiness(user.id, {
      displayName: "Gear store",
      categories: ["GEAR_SELLER"],
    });

    const result = await getNearbyRiderServices({
      latitude: 12.9716,
      longitude: 77.5946,
      category: "MECHANIC",
      radiusKm: 5,
    });

    expect(result.map((service) => service.id)).toEqual([closest.id, farther.id]);
    expect(result.map((service) => service.distanceKm)).toEqual(
      [...result.map((service) => service.distanceKm)].sort((a, b) => a - b),
    );
  });

  it("excludes businesses without usable coordinates", async () => {
    const { user } = await createTestUser();
    await createBusiness(user.id, {
      displayName: "No coordinates",
      latitude: null,
      longitude: null,
    });

    const result = await getNearbyRiderServices({
      latitude: 12.9716,
      longitude: 77.5946,
      radiusKm: 10,
    });

    expect(result).toEqual([]);
  });
});
