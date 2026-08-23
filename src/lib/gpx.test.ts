import { describe, it, expect } from "vitest";
import { rideToGpx } from "./gpx.js";

describe("rideToGpx", () => {
  it("should convert a bare LineString GeoJSON into valid GPX 1.1 XML", () => {
    const geoJson = JSON.stringify({
      type: "LineString",
      coordinates: [
        [77.5946, 12.9716, 920],
        [77.6000, 12.9800, 925],
      ],
    });

    const gpx = rideToGpx({
      rideId: "ride-123",
      title: "Weekend Ride <Test>",
      description: "A fun ride & tour",
      startTime: new Date("2026-05-01T10:00:00.000Z"),
      routeGeoJson: geoJson,
    });

    expect(gpx).toContain('creator="Revvie"');
    expect(gpx).toContain("<name>Weekend Ride &lt;Test&gt;</name>");
    expect(gpx).toContain("<desc>A fun ride &amp; tour</desc>");
    expect(gpx).toContain('<trkpt lat="12.9716" lon="77.5946"><ele>920</ele></trkpt>');
    expect(gpx).toContain('<trkpt lat="12.98" lon="77.6"><ele>925</ele></trkpt>');
  });

  it("should handle Feature wrapped LineString GeoJSON", () => {
    const geoJson = JSON.stringify({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[77.1025, 28.7041]],
      },
    });

    const gpx = rideToGpx({
      rideId: "ride-456",
      title: "Delhi Solo",
      routeGeoJson: geoJson,
    });

    expect(gpx).toContain('<trkpt lat="28.7041" lon="77.1025"></trkpt>');
  });

  it("should return empty track segment when routeGeoJson is invalid", () => {
    const gpx = rideToGpx({
      rideId: "ride-789",
      title: "Corrupted Route",
      routeGeoJson: "invalid-json",
    });

    expect(gpx).toContain("<trkseg>");
    expect(gpx).toContain("</trkseg>");
  });
});
