import { describe, it, expect } from "vitest";
import { ElevationService } from "./elevation.service.js";

describe("ElevationService", () => {
  describe("parseRouteGeoJson", () => {
    it("should return null for invalid or missing JSON", () => {
      expect(ElevationService.parseRouteGeoJson(null)).toBeNull();
      expect(ElevationService.parseRouteGeoJson("invalid-json")).toBeNull();
    });

    it("should parse valid GeoJSON LineString coordinates", () => {
      const geoJson = JSON.stringify({
        type: "LineString",
        coordinates: [
          [77.59, 12.97, 900],
          [77.60, 12.98, 920],
        ],
      });

      const parsed = ElevationService.parseRouteGeoJson(geoJson);
      expect(parsed).toEqual({
        type: "LineString",
        coordinates: [
          [77.59, 12.97, 900],
          [77.60, 12.98, 920],
        ],
      });
    });
  });

  describe("calculateElevationGainFromCoordinates", () => {
    it("should compute cumulative positive altitude gain in meters", () => {
      const coords: [number, number, number][] = [
        [77.59, 12.97, 100],
        [77.60, 12.98, 150], // +50
        [77.61, 12.99, 130], // downhill (-20, ignored)
        [77.62, 13.00, 180], // +50
      ];

      const gain = ElevationService.calculateElevationGainFromCoordinates(coords);
      expect(gain).toBe(100);
    });

    it("should return 0 when fewer than 2 coordinates exist", () => {
      expect(ElevationService.calculateElevationGainFromCoordinates([[77.59, 12.97, 100]])).toBe(0);
    });
  });

  describe("resolveElevationGain", () => {
    it("should prioritize explicit elevationGainM if provided", () => {
      const result = ElevationService.resolveElevationGain({
        elevationGainM: 250,
        routeGeoJson: null,
      });
      expect(result).toBe(250);
    });

    it("should fallback to calculating gain from routeGeoJson if explicit value is missing", () => {
      const geoJson = JSON.stringify({
        type: "LineString",
        coordinates: [
          [77.59, 12.97, 100],
          [77.60, 12.98, 145],
        ],
      });

      const result = ElevationService.resolveElevationGain({
        elevationGainM: null,
        routeGeoJson: geoJson,
      });
      expect(result).toBe(45);
    });
  });
});
