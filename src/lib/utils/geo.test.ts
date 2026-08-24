/**
 * Geo utility tests — Haversine distance + bounding box pre-filter.
 * Known city-pair distances anchor the formula against real geography.
 */

import { haversineDistance, boundingBox } from "./geo.js";

// [label, lat1, lng1, lat2, lng2, expectedKm, tolerancePercent]
const KNOWN_DISTANCES: Array<[string, number, number, number, number, number]> =
  [
    // Berlin → Paris ≈ 878 km
    ["Berlin→Paris", 52.52, 13.405, 48.8566, 2.3522, 878],
    // New York → Los Angeles ≈ 3936 km
    ["NYC→LA", 40.7128, -74.006, 34.0522, -118.2437, 3936],
    // London → Amsterdam ≈ 357 km
    ["London→Amsterdam", 51.5074, -0.1278, 52.3676, 4.9041, 357],
    // Quito (equator) — 1° of longitude ≈ 111.19 km
    ["1° longitude at equator", 0, 0, 0, 1, 111.19],
    // Pole-to-pole half circumference ≈ 20015 km
    ["North pole→South pole", 90, 0, -90, 0, 20015],
    // 1° latitude anywhere ≈ 111.19 km
    ["1° latitude", 10, 20, 11, 20, 111.19],
  ];

describe("haversineDistance — known distances", () => {
  it.each(KNOWN_DISTANCES)(
    "%s is ~%i km",
    (_label, lat1, lng1, lat2, lng2, expectedKm) => {
      const d = haversineDistance(lat1, lng1, lat2, lng2);
      expect(Math.abs(d - expectedKm) / expectedKm).toBeLessThan(0.02);
    },
  );
});

describe("haversineDistance — invariants", () => {
  const POINTS: Array<[number, number]> = [
    [0, 0],
    [52.52, 13.405],
    [-33.8688, 151.2093], // Sydney
    [90, 0], // North pole
    [-90, 123], // South pole
    [41.3851, 2.1734], // Barcelona
  ];

  it("returns exactly 0 for identical points", () => {
    for (const [lat, lng] of POINTS) {
      expect(haversineDistance(lat, lng, lat, lng)).toBeCloseTo(0, 6);
    }
  });

  it.each(POINTS.map((p, i) => [i, p] as const))(
    "is symmetric for point pair %i",
    (_i, [lat, lng]) => {
      for (const [lat2, lng2] of POINTS) {
        const ab = haversineDistance(lat, lng, lat2, lng2);
        const ba = haversineDistance(lat2, lng2, lat, lng);
        expect(ab).toBeCloseTo(ba, 6);
      }
    },
  );

  it("never exceeds half the Earth's circumference", () => {
    for (let lat1 = -90; lat1 <= 90; lat1 += 45) {
      for (let lng1 = -180; lng1 <= 180; lng1 += 60) {
        const d = haversineDistance(lat1, lng1, -lat1, lng1 + 137);
        expect(d).toBeLessThanOrEqual(20015.1 + 0.5);
        expect(d).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("antimeridian crossing stays finite and sane", () => {
    const d = haversineDistance(0, 179.9, 0, -179.9);
    // ~0.2° apart across the dateline ≈ 22 km
    expect(d).toBeGreaterThan(15);
    expect(d).toBeLessThan(30);
  });

  it("grows monotonically with longitude separation at the equator", () => {
    let prev = 0;
    for (const deg of [1, 5, 10, 30, 60]) {
      const d = haversineDistance(0, 0, 0, deg);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });
});

describe("boundingBox", () => {
  it("contains the centre point", () => {
    const bb = boundingBox(52.52, 13.405, 25);
    expect(bb.minLat).toBeLessThan(52.52);
    expect(bb.maxLat).toBeGreaterThan(52.52);
    expect(bb.minLng).toBeLessThan(13.405);
    expect(bb.maxLng).toBeGreaterThan(13.405);
  });

  it.each([
    [52.52, 13.405, 10],
    [52.52, 13.405, 100],
    [0, 0, 500],
    [-33.8688, 151.2093, 50],
    [64.1466, -21.9426, 250], // Reykjavik — high latitude
  ])(
    "points at radius %s km from centre sit inside or on the box edge",
    (lat, lng, radiusKm) => {
      const bb = boundingBox(lat, lng, radiusKm);
      // A point due north/south/east/west at the full radius must be inside.
      const latDegPerKm = radiusKm / 110.574;
      const lngDegPerKm =
        radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

      expect(lat + latDegPerKm).toBeLessThanOrEqual(bb.maxLat + 0.5);
      expect(lat - latDegPerKm).toBeGreaterThanOrEqual(bb.minLat - 0.5);
      expect(lng + lngDegPerKm).toBeLessThanOrEqual(bb.maxLng + 0.5);
      expect(lng - lngDegPerKm).toBeGreaterThanOrEqual(bb.minLng - 0.5);
    },
  );

  it("widens in longitude at higher latitudes for the same radius", () => {
    const equator = boundingBox(0, 0, 100);
    const north = boundingBox(60, 0, 100);
    const eqWidth = equator.maxLng - equator.minLng;
    const nWidth = north.maxLng - north.minLng;
    expect(nWidth).toBeGreaterThan(eqWidth);
    expect(nWidth).toBeCloseTo(eqWidth / Math.cos((60 * Math.PI) / 180), 1);
  });

  it("keeps symmetric lat/long spans around the centre", () => {
    const bb = boundingBox(48.85, 2.35, 75);
    expect(bb.maxLat - 48.85).toBeCloseTo(48.85 - bb.minLat, 9);
    expect(bb.maxLng - 2.35).toBeCloseTo(2.35 - bb.minLng, 9);
  });

  it("degrades gracefully with a tiny radius", () => {
    const bb = boundingBox(10, 10, 0.001);
    expect(bb.maxLat - bb.minLat).toBeGreaterThan(0);
    expect(bb.maxLat - bb.minLat).toBeLessThan(0.0001);
  });
});
