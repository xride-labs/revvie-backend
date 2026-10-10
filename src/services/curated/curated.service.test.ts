import { describe, it, expect } from "vitest";
import {
  getCuratedItineraries,
  getCuratedItineraryById,
  getCuratedPlaces
} from "./curated.service.js";

describe("Curated Service", () => {
  it("fetches curated itineraries with pagination", async () => {
    const res = await getCuratedItineraries({ page: 1, limit: 10 });
    expect(res).toBeDefined();
    expect(res.items).toBeInstanceOf(Array);
    expect(res.pagination).toBeDefined();
    expect(res.pagination.page).toBe(1);
    expect(res.pagination.limit).toBe(10);
  });

  it("filters curated itineraries by theme", async () => {
    const res = await getCuratedItineraries({ theme: "NAVADURGAS" as any });
    expect(res.items.length).toBeGreaterThan(0);
    res.items.forEach((item) => {
      expect(item.theme).toBe("NAVADURGAS");
    });
  });

  it("filters curated itineraries by duration tier", async () => {
    const res = await getCuratedItineraries({ durationTier: "HALF_DAY" as any });
    expect(res.items.length).toBeGreaterThan(0);
    res.items.forEach((item) => {
      expect(item.durationTier).toBe("HALF_DAY");
    });
  });

  it("filters curated itineraries by highway corridor", async () => {
    const res = await getCuratedItineraries({ corridor: "MYSORE_ROAD" });
    expect(res.items.length).toBeGreaterThan(0);
    res.items.forEach((item) => {
      expect(item.corridor).toBe("MYSORE_ROAD");
    });
  });

  it("retrieves full itinerary details with waypoints", async () => {
    const list = await getCuratedItineraries({ limit: 1 });
    expect(list.items.length).toBeGreaterThan(0);
    const target = list.items[0];

    const detail = await getCuratedItineraryById(target.id);
    expect(detail).toBeDefined();
    expect(detail.id).toBe(target.id);
    expect(detail.waypoints).toBeInstanceOf(Array);
    expect(detail.waypoints.length).toBeGreaterThan(0);
  });

  it("fetches curated places filtered by corridor and rating", async () => {
    const places = await getCuratedPlaces({
      corridor: "MYSORE_ROAD",
      minRating: 4.5
    });
    expect(places.items.length).toBeGreaterThan(0);
    places.items.forEach((p) => {
      expect(p.corridor).toBe("MYSORE_ROAD");
      expect(p.rating).toBeGreaterThanOrEqual(4.5);
    });
  });
});
