/**
 * Revvie backend — k6 load test.
 *
 * Auth: Better Auth (email/password). The bearer() plugin returns the session
 * token in the `set-auth-token` response header on sign-up/sign-in, which we
 * then send as `Authorization: Bearer <token>`. (k6 also keeps a per-VU cookie
 * jar, so the session cookie works as a fallback automatically.)
 *
 * Scenarios (pick with -e SCENARIO=smoke|load|stress|spike):
 *   smoke  — 10 VUs, 1m            sanity check that the system works under light load
 *   load   — ramp to 500, hold 5m  expected peak traffic; SLOs enforced as thresholds
 *   stress — climb past 1500       find the breaking point (where errors/latency spike)
 *   spike  — slam 1000 instantly   test sudden burst recovery
 *
 * Run:
 *   k6 run -e SCENARIO=smoke  loadtest.js
 *   k6 run -e SCENARIO=load   -e BASE_URL=http://localhost:5000 loadtest.js
 *   k6 run -e SCENARIO=stress -e INCLUDE_WRITES=1 loadtest.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const SCENARIO = __ENV.SCENARIO || "smoke";
const INCLUDE_WRITES = __ENV.INCLUDE_WRITES === "1";
const PASSWORD = "LoadTest123!";

// ── Custom metrics ───────────────────────────────────────────────────────────
const signupTrend = new Trend("auth_signup_duration", true);
const authedReqs = new Counter("authenticated_requests");
const rateLimited = new Rate("rate_limited_429"); // watch this — see README

// ── Scenario / threshold profiles ────────────────────────────────────────────
const PROFILES = {
  smoke: {
    stages: [{ duration: "1m", target: 10 }],
    thresholds: {
      http_req_failed: ["rate<0.01"],
      http_req_duration: ["p(95)<500"],
    },
  },
  load: {
    stages: [
      { duration: "30s", target: 100 }, // ramp up
      { duration: "1m", target: 500 }, // ramp to peak
      { duration: "5m", target: 500 }, // hold peak
      { duration: "30s", target: 0 }, // ramp down
    ],
    thresholds: {
      http_req_failed: ["rate<0.01"], // <1% errors
      http_req_duration: ["p(95)<500", "p(99)<1000"], // SLOs
      authenticated_requests: ["count>10000"],
    },
  },
  stress: {
    stages: [
      { duration: "1m", target: 200 },
      { duration: "2m", target: 500 },
      { duration: "2m", target: 1000 },
      { duration: "2m", target: 1500 },
      { duration: "1m", target: 0 },
    ],
    // Looser thresholds: stress is about FINDING the limit, not passing an SLO.
    thresholds: {
      http_req_failed: ["rate<0.25"],
      http_req_duration: ["p(95)<2500"],
    },
  },
  spike: {
    stages: [
      { duration: "10s", target: 50 },
      { duration: "10s", target: 1000 }, // instant burst
      { duration: "1m", target: 1000 },
      { duration: "20s", target: 50 }, // recovery
      { duration: "10s", target: 0 },
    ],
    thresholds: {
      http_req_failed: ["rate<0.10"],
      http_req_duration: ["p(95)<1500"],
    },
  },
};

const profile = PROFILES[SCENARIO] || PROFILES.smoke;
export const options = {
  stages: profile.stages,
  thresholds: profile.thresholds,
  // Surface the slowest endpoints in the summary.
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// ── Per-VU session (module scope is per-VU in k6) ────────────────────────────
let token = null;

function jsonHeaders(extra) {
  return Object.assign({ "Content-Type": "application/json" }, extra || {});
}

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getAuthToken(res) {
  // header casing varies; check the common variants.
  const h = res.headers;
  return (
    h["Set-Auth-Token"] || h["set-auth-token"] || h["Set-auth-token"] || null
  );
}

function signUp() {
  const email = `loadtest_${__VU}_${__ITER}_${Date.now()}@example.com`;
  const res = http.post(
    `${BASE_URL}/api/auth/sign-up/email`,
    JSON.stringify({ email, password: PASSWORD, name: `LoadTest VU${__VU}` }),
    { headers: jsonHeaders(), tags: { name: "auth:sign-up" } },
  );
  signupTrend.add(res.timings.duration);
  if (res.status === 429) rateLimited.add(1);
  else rateLimited.add(0);
  check(res, { "sign-up 200/201": (r) => r.status === 200 || r.status === 201 });
  return getAuthToken(res);
}

// ── VU lifecycle ─────────────────────────────────────────────────────────────
export default function () {
  // Establish a session once per VU, reuse the token across iterations.
  if (!token) {
    token = signUp();
    if (!token) {
      // sign-up failed (rate limit / error) — back off and retry next iter.
      sleep(1);
      return;
    }
  }

  group("read: current user", () => {
    const res = http.get(`${BASE_URL}/api/account/me`, {
      headers: authHeaders(),
      tags: { name: "GET /api/account/me" },
    });
    authedReqs.add(1);
    check(res, { "me 200": (r) => r.status === 200 });
  });

  group("read: lists", () => {
    const reqs = {
      "GET /api/rides": {
        method: "GET",
        url: `${BASE_URL}/api/rides?page=1&limit=20`,
        params: { headers: authHeaders(), tags: { name: "GET /api/rides" } },
      },
      "GET /api/users": {
        method: "GET",
        url: `${BASE_URL}/api/users?page=1&limit=20`,
        params: { headers: authHeaders(), tags: { name: "GET /api/users" } },
      },
      "GET /api/feed": {
        method: "GET",
        url: `${BASE_URL}/api/feed`,
        params: { headers: authHeaders(), tags: { name: "GET /api/feed" } },
      },
      "GET /api/clubs": {
        method: "GET",
        url: `${BASE_URL}/api/clubs?page=1&limit=20`,
        params: { headers: authHeaders(), tags: { name: "GET /api/clubs" } },
      },
      // /api/discover requires geo params (lat/lng); bare calls return 400.
      "GET /api/discover": {
        method: "GET",
        url: `${BASE_URL}/api/discover?lat=40.7128&lng=-74.006&radiusKm=10`,
        params: { headers: authHeaders(), tags: { name: "GET /api/discover" } },
      },
    };
    const responses = http.batch(reqs);
    authedReqs.add(Object.keys(reqs).length);
    for (const key of Object.keys(responses)) {
      check(responses[key], { [`${key} ok`]: (r) => r.status === 200 });
    }
  });

  if (INCLUDE_WRITES && __ITER % 10 === 0) {
    group("write: create ride", () => {
      const body = {
        title: `Load Ride VU${__VU}-${__ITER}`,
        description: "Created by k6 load test",
        startLocation: "Start",
        endLocation: "End",
        experienceLevel: "Beginner",
        pace: "Moderate",
        distance: 25,
        duration: 90,
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        latitude: 40.7128,
        longitude: -74.006,
      };
      const res = http.post(`${BASE_URL}/api/rides`, JSON.stringify(body), {
        headers: jsonHeaders(authHeaders()),
        tags: { name: "POST /api/rides" },
      });
      authedReqs.add(1);
      check(res, { "create ride 201": (r) => r.status === 201 });
    });
  }

  // Public health probe (no auth) — cheap baseline.
  http.get(`${BASE_URL}/health`, { tags: { name: "GET /health" } });

  sleep(Math.random() * 2 + 1); // think time 1–3s
}
