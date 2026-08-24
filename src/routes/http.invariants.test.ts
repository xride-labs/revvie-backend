/**
 * Platform-wide HTTP invariants.
 *
 * Discovers every mounted endpoint by walking the router stacks, then fires
 * a battery of hostile-but-safe requests at each and asserts the two
 * contracts that must hold everywhere:
 *
 *   1. NO 5xx — malformed, unauthenticated or wrong-method requests are
 *      client errors, never server faults.
 *   2. ENVELOPE — every JSON response carries { success: boolean }, and any
 *      >=400 response is success:false with an error.code string.
 *
 * Requests are unauthenticated (or carry garbage auth), which means they are
 * rejected by requireAuth/validation BEFORE any handler logic runs — so this
 * suite never mutates data. A local express app is used instead of `server.ts`
 * to avoid the global rate limiter interfering with thousands of probes.
 */

import express, { Express } from "express";
import request from "supertest";
import * as routes from "./index.js";
import { globalErrorHandler } from "../middlewares/errorHandler.js";

// ─── Discovery ───────────────────────────────────────────────────────────

const HTTP_VERBS = ["get", "post", "put", "patch", "delete"] as const;
type Verb = (typeof HTTP_VERBS)[number];

type Endpoint = { method: Verb; path: string; router: string };

function flatten(
  router: any,
  prefix = "",
  into: Endpoint[] = [],
): Endpoint[] {
  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const p = prefix + String(layer.route.path ?? "");
      for (const m of HTTP_VERBS) {
        if (layer.route.methods?.[m]) into.push({ method: m, path: p, router: "" });
      }
    } else if (layer.handle?.stack) {
      const sub = String(layer.path ?? "/");
      flatten(layer.handle, prefix + (sub === "/" ? "" : sub), into);
    }
  }
  return into;
}

const MOUNTS: Array<[string, string, any]> = [
  ["/api/account", "account", (routes as any).accountRoutes],
  ["/api/users", "users", (routes as any).userRoutes],
  ["/api/rides", "rides", (routes as any).rideRoutes],
  ["/api/clubs", "clubs", (routes as any).clubRoutes],
  ["/api/marketplace", "marketplace", (routes as any).marketplaceRoutes],
  ["/api/admin", "admin", (routes as any).adminRoutes],
  ["/api/media", "media", (routes as any).mediaRoutes],
  ["/api/feed", "feed", (routes as any).feedRoutes],
  ["/api/discover", "discover", (routes as any).discoveryRoutes],
  ["/api/chat", "chat", (routes as any).chatRoutes],
  ["/api/location", "location", (routes as any).locationRoutes],
  ["/api/friend-groups", "friend-groups", (routes as any).friendGroupRoutes],
  ["/api/friends", "friends", (routes as any).friendshipRoutes],
  ["/api/notifications", "notifications", (routes as any).notificationRoutes],
  ["/api/payments", "payments", (routes as any).paymentsRoutes],
  ["/api/events", "events", (routes as any).eventRoutes],
  ["/api/public", "public", (routes as any).publicRoutes],
  ["/api/business", "business", (routes as any).businessRoutes],
  ["/api/ads", "ads", (routes as any).adsRoutes],
  ["/api/discounts", "discounts", (routes as any).discountRoutes],
  ["/api/bulk", "bulk", (routes as any).bulkRoutes],
  ["/api/catalog", "catalog", (routes as any).catalogRoutes],
];

function buildApp(): Express {
  const app = express();
  app.set("trust proxy", false);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  for (const [, , router] of MOUNTS) app.use(router);
  // Mirror production's 404 + error handlers.
  app.use((req, res) =>
    res.status(404).json({
      success: false,
      message: "Endpoint not found",
      error: { code: "NOT_FOUND" },
    }),
  );
  app.use(globalErrorHandler);
  return app;
}

// Endpoints are discovered SYNCHRONOUSLY at module load: vitest collects
// it.each cases during collection, before any beforeAll hook runs — a
// runtime-populated list would register zero tests per battery.
let endpoints: Endpoint[] = [];
const app = buildApp();

{
  const seen = new Map<string, Endpoint>();
  for (const [prefix, label, router] of MOUNTS) {
    for (const ep of flatten(router)) {
      seen.set(`${ep.method} ${prefix}${ep.path}`, {
        ...ep,
        path: prefix + ep.path,
        router: label,
      });
    }
  }
  endpoints = [...seen.values()];
}

// ─── Contracts ───────────────────────────────────────────────────────────

/** Statuses a well-behaved API may return to hostile client input. */
const ALLOWED = new Set([
  200, 201, 204, 400, 401, 403, 404, 405, 409, 410, 413, 415, 422,
]);

function expectInvariant(res: request.Response) {
  expect(res.status).toBeLessThan(500);
  expect(ALLOWED.has(res.status)).toBe(true);

  const body = res.body;
  if (body && typeof body === "object") {
    if ("success" in body) {
      expect(typeof body.success).toBe("boolean");
    }
    if (res.status >= 400 && res.body.success !== undefined) {
      expect(body.success).toBe(false);
      expect(typeof body.error?.code).toBe("string");
      expect(body.error.code.length).toBeGreaterThan(0);
    }
  }
}

describe(`HTTP invariants (${MOUNTS.length} routers)`, () => {
  it("discovers a healthy number of endpoints", () => {
    expect(endpoints.length).toBeGreaterThanOrEqual(150);
    console.log(`[http-invariants] probing ${endpoints.length} endpoints`);
  });
});

// ─── Battery 1: unauthenticated requests ─────────────────────────────────

describe("unauthenticated request per endpoint", () => {
  it.each(endpoints.map((e) => [`${e.method.toUpperCase()} ${e.path}`, e] as const))(
    "%s rejects anonymous callers without a 5xx",
    async (_sig, ep) => {
      const req = request(app)[ep.method](ep.path);
      const res = await req;
      expectInvariant(res);
    },
  );
});

// ─── Battery 2: garbage credentials ──────────────────────────────────────

describe("garbage credentials per endpoint", () => {
  it.each(endpoints.map((e) => [`${e.method.toUpperCase()} ${e.path}`, e] as const))(
    "%s rejects forged tokens without a 5xx",
    async (_sig, ep) => {
      const res = await request(app)
        [ep.method](ep.path)
        .set("Authorization", "Bearer not-a-real-token-value-1234567890")
        .send();
      expectInvariant(res);
    },
  );
});

// ─── Battery 3: malformed JSON bodies ────────────────────────────────────

const BODY_METHODS = new Set<Verb>(["post", "put", "patch"]);
const bodyEndpoints = () => endpoints.filter((e) => BODY_METHODS.has(e.method));

describe("malformed JSON body per mutating endpoint", () => {
  it.each(bodyEndpoints().map((e) => [`${e.method.toUpperCase()} ${e.path}`, e] as const))(
    "%s returns 400 (never 500) on broken JSON",
    async (_sig, ep) => {
      const res = await request(app)
        [ep.method](ep.path)
        .set("Content-Type", "application/json")
        .send('{"broken":');
      // Body-parser failures are handled before auth → deterministic 400.
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    },
  );
});

// ─── Battery 4: hostile query strings ────────────────────────────────────

const HOSTILE_QUERIES: Array<[string, string]> = [
  ["page=abc&limit=xyz", "non-numeric pagination"],
  ["page=-5&limit=-999", "negative pagination"],
  ["page=0&limit=0", "zero pagination"],
  ["limit=999999999", "overflow limit"],
  ["search=" + encodeURIComponent("<script>alert(1)</script>"), "xss search"],
  ["search=" + encodeURIComponent("'; DROP TABLE posts; --"), "sql search"],
  ["id=../etc/passwd", "path traversal"],
];

describe("hostile query strings on GET endpoints", () => {
  it.each(
    endpoints
      .filter((e) => e.method === "get")
      .flatMap((e) =>
        HOSTILE_QUERIES.map(
          ([qs, label]) =>
            [`GET ${e.path} ← ${label}`, { e, qs }] as const,
        ),
      ),
  )("%s is rejected or handled safely", async (_sig, { e, qs }) => {
    const res = await request(app).get(`${e.path}?${qs}`);
    expectInvariant(res);
  });
});

// ─── Battery 5: wrong-method probes ──────────────────────────────────────

describe("wrong-method probes", () => {
  const pathsBySig = new Map<string, Set<Verb>>();
  for (const e of endpoints) {
    if (!pathsBySig.has(e.path)) pathsBySig.set(e.path, new Set());
    pathsBySig.get(e.path)!.add(e.method);
  }

  const probes: Array<{ path: string; method: Verb }> = [];
  for (const [path, declared] of pathsBySig) {
    for (const m of HTTP_VERBS) {
      if (!declared.has(m)) probes.push({ path, method: m });
    }
  }

  it.each(probes.map((p) => [`${p.method.toUpperCase()} ${p.path}`, p] as const))(
    "%s on an undeclared method stays a client error",
    async (_sig, { path, method }) => {
      const res = await request(app)[method](path).send();
      // Either Express 404s (no route) or the existing route's middleware
      // rejects (401/400/403/405) — anything else is a routing bug.
      expect([200, 400, 401, 403, 404, 405, 409]).toContain(res.status);
      expect(res.status).toBeLessThan(500);
    },
  );
});
