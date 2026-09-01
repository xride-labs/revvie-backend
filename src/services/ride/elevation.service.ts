export type RouteCoordinate = [number, number, number?];

interface GeoJsonLineString {
  type: "LineString";
  coordinates: RouteCoordinate[];
}

export class ElevationService {
  /**
   * Safely parse a GeoJSON LineString payload from the mobile tracker.
   */
  static parseRouteGeoJson(
    routeGeoJson?: string | null,
  ): GeoJsonLineString | null {
    if (!routeGeoJson) return null;

    try {
      const parsed = JSON.parse(routeGeoJson) as {
        type?: string;
        coordinates?: unknown;
      };

      if (parsed.type !== "LineString" || !Array.isArray(parsed.coordinates)) {
        return null;
      }

      const coordinates = parsed.coordinates.filter(
        (item): item is RouteCoordinate =>
          Array.isArray(item) &&
          item.length >= 2 &&
          typeof item[0] === "number" &&
          typeof item[1] === "number" &&
          (item.length < 3 || typeof item[2] === "number"),
      );

      return { type: "LineString", coordinates };
    } catch {
      return null;
    }
  }

  /**
   * Sum only positive altitude deltas to derive total elevation gain in meters.
   */
  static calculateElevationGainFromCoordinates(
    coordinates: RouteCoordinate[],
  ): number {
    if (coordinates.length < 2) return 0;

    let gain = 0;

    for (let i = 1; i < coordinates.length; i++) {
      const prevAltitude = coordinates[i - 1][2];
      const currAltitude = coordinates[i][2];

      if (
        typeof prevAltitude !== "number" ||
        typeof currAltitude !== "number"
      ) {
        continue;
      }

      const delta = currAltitude - prevAltitude;
      if (delta > 0) {
        gain += delta;
      }
    }

    return Math.round(gain * 100) / 100;
  }

  /**
   * Resolve elevation gain from explicit value first, then from route coordinates.
   */
  static resolveElevationGain(input: {
    elevationGainM?: number | null;
    routeGeoJson?: string | null;
  }): number | null {
    if (
      typeof input.elevationGainM === "number" &&
      !Number.isNaN(input.elevationGainM)
    ) {
      return Math.max(0, input.elevationGainM);
    }

    const route = this.parseRouteGeoJson(input.routeGeoJson);
    if (!route) return null;

    return this.calculateElevationGainFromCoordinates(route.coordinates);
  }
}
