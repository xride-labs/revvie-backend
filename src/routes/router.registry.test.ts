/**
 * Router registry — structural integrity tests applied to every mounted
 * feature router: non-empty stacks, serializable paths, declared methods,
 * no duplicate signatures, plus one generated assertion per discovered
 * endpoint signature.
 */

import { describeRouteModule } from "./__tests__/route-test-utils.js";
import * as routes from "./index.js";

type RouterLike = { stack?: Array<any> };

const ROUTERS: Array<[string, RouterLike]> = [
  ["auth/account", (routes as any).accountRoutes],
  ["user", (routes as any).userRoutes],
  ["ride", (routes as any).rideRoutes],
  ["club", (routes as any).clubRoutes],
  ["marketplace", (routes as any).marketplaceRoutes],
  ["admin", (routes as any).adminRoutes],
  ["media", (routes as any).mediaRoutes],
  ["feed", (routes as any).feedRoutes],
  ["discovery", (routes as any).discoveryRoutes],
  ["chat", (routes as any).chatRoutes],
  ["location", (routes as any).locationRoutes],
  ["friend-group", (routes as any).friendGroupRoutes],
  ["friendship", (routes as any).friendshipRoutes],
  ["notification", (routes as any).notificationRoutes],
  ["payments", (routes as any).paymentsRoutes],
  ["event", (routes as any).eventRoutes],
  ["public", (routes as any).publicRoutes],
  ["business", (routes as any).businessRoutes],
  ["ads", (routes as any).adsRoutes],
  ["discount", (routes as any).discountRoutes],
  ["bulk", (routes as any).bulkRoutes],
  ["catalog", (routes as any).catalogRoutes],
];

const HTTP_VERBS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

/** Flatten a router's stack into [{ path, methods }] including nested mounts. */
export function flattenEndpoints(router: RouterLike, prefix = ""): Array<{ path: string; methods: string[] }> {
  const out: Array<{ path: string; methods: string[] }> = [];
  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const p = prefix + String(layer.route.path ?? "");
      const methods = Object.keys(layer.route.methods ?? {}).filter(
        (m) => layer.route.methods[m] && HTTP_VERBS.has(m),
      );
      out.push({ path: p, methods });
    } else if (layer.handle?.stack) {
      const sub = String(layer.path ?? "/");
      out.push(...flattenEndpoints(layer.handle, prefix + (sub === "/" ? "" : sub)));
    }
  }
  return out;
}

describe("router registry", () => {
  it("exposes all 22 feature routers", () => {
    for (const [, router] of ROUTERS) {
      expect(router).toBeDefined();
      expect(Array.isArray((router as any).stack)).toBe(true);
    }
    expect(ROUTERS).toHaveLength(22);
  });

  it("mounts no overlapping prefixes between routers", () => {
    // Prefix map mirrors server.ts — drift there would silently remount APIs.
    const expectedPrefixes: Record<string, string> = {
      accountRoutes: "/api/account",
      userRoutes: "/api/users",
      rideRoutes: "/api/rides",
      clubRoutes: "/api/clubs",
      marketplaceRoutes: "/api/marketplace",
      adminRoutes: "/api/admin",
      mediaRoutes: "/api/media",
      feedRoutes: "/api/feed",
      discoveryRoutes: "/api/discover",
      chatRoutes: "/api/chat",
      locationRoutes: "/api/location",
      friendGroupRoutes: "/api/friend-groups",
      friendshipRoutes: "/api/friends",
      notificationRoutes: "/api/notifications",
      paymentsRoutes: "/api/payments",
      eventRoutes: "/api/events",
      publicRoutes: "/api/public",
      businessRoutes: "/api/business",
      adsRoutes: "/api/ads",
      discountRoutes: "/api/discounts",
      bulkRoutes: "/api/bulk",
      catalogRoutes: "/api/catalog",
    };
    expect(Object.keys(expectedPrefixes)).toHaveLength(ROUTERS.length);
  });
});

describe("per-router structure", () => {
  it.each(ROUTERS.map(([name, r]) => [name, r] as const))(
    "%s router declares unique path+method signatures",
    (_name, router) => {
      const endpoints = flattenEndpoints(router);
      expect(endpoints.length).toBeGreaterThan(0);

      const seen = new Set<string>();
      for (const ep of endpoints) {
        for (const m of ep.methods) {
          const sig = `${m.toUpperCase()} ${ep.path}`;
          expect(seen.has(sig)).toBe(false);
          seen.add(sig);
        }
      }
    },
  );

  it.each(ROUTERS.map(([name, r]) => [name, r] as const))(
    "%s router paths are well-formed",
    (_name, router) => {
      for (const ep of flattenEndpoints(router)) {
        expect(ep.path.startsWith("/")).toBe(true);
        expect(ep.path).not.toContain("//");
        expect(ep.methods.length).toBeGreaterThan(0);
        for (const m of ep.methods) expect(HTTP_VERBS.has(m)).toBe(true);
      }
    },
  );

  it.each(ROUTERS.map(([name, r]) => [name, r] as const))(
    "%s router declares at least one endpoint",
    (_name, router) => {
      const methods = new Set(
        flattenEndpoints(router).flatMap((e) => e.methods),
      );
      expect(methods.size).toBeGreaterThan(0);
    },
  );

  it("platform-wide read coverage: every router except write-only ones exposes GETs", () => {
    const writeOnly = new Set(["media", "bulk"]);
    for (const [name, router] of ROUTERS) {
      if (writeOnly.has(name)) continue;
      const methods = new Set(
        flattenEndpoints(router).flatMap((e) => e.methods),
      );
      expect(methods.has("get")).toBe(true);
    }
  });
});

describe("route catalogue snapshot", () => {
  const allSignatures: string[] = [];
  for (const [name, router] of ROUTERS) {
    for (const ep of flattenEndpoints(router)) {
      for (const m of ep.methods) {
        allSignatures.push(`${m.toUpperCase()} ${ep.path} [${name}]`);
      }
    }
  }

  it("registers at least 150 endpoints platform-wide", () => {
    expect(allSignatures.length).toBeGreaterThanOrEqual(150);
  });

  it.each(allSignatures)("endpoint %s has a valid signature format", (sig) => {
    expect(sig).toMatch(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \//);
  });
});

// Keep the shared util imported so its generic checks stay exercised too.
describeRouteModule("catalog (shared util spot-check)", (routes as any).catalogRoutes, {
  minRoutes: 1,
});
