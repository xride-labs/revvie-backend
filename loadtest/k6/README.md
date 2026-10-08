# k6 load tests — Revvie backend

Load tests for the Express/Better Auth API. Drives a realistic flow: each
virtual user (VU) signs up once via Better Auth, then loops over read-heavy
authenticated endpoints (`/account/me`, `/rides`, `/users`, `/feed`, `/clubs`)
plus an optional ride-create write.

## 1. Install k6

k6 is a single Go binary (not an npm package).

```powershell
winget install k6.k6           # Windows (winget)
# or:  choco install k6
# or:  scoop install k6
```

macOS: `brew install k6` · Linux: see https://grafana.com/docs/k6/latest/set-up/install-k6/

Verify: `k6 version`

## 2. Start the backend (separate terminal)

```powershell
cd e:\xride-labs\revvie\backend
bun run dev          # needs Postgres + Mongo up (docker compose)
```

Default target is `http://localhost:5000`. Override with `-e BASE_URL=...`.

> ⚠️ **Rate limiting.** `src/server.ts` caps the API at 10k req/min and auth at
> 1k/15min (non-prod). Above ~150 sustained VUs you'll hit HTTP 429s, which
> inflate the error rate and hide real latency. The script tracks these in the
> `rate_limited_429` metric. For a true load test, temporarily raise/disable the
> limiters (or run with fewer VUs). See "Rate limiting" below.

## 3. Run

```powershell
cd e:\xride-labs\revvie\backend\loadtest\k6

k6 run -e SCENARIO=smoke  loadtest.js          # 10 VUs, 1m — sanity
k6 run -e SCENARIO=load   loadtest.js          # ramp to 500, hold 5m — peak SLO
k6 run -e SCENARIO=stress loadtest.js          # climb to 1500 — find breaking point
k6 run -e SCENARIO=spike  loadtest.js          # instant 1000 — burst recovery

# options:
k6 run -e SCENARIO=load -e BASE_URL=http://localhost:5000 loadtest.js
k6 run -e SCENARIO=load -e INCLUDE_WRITES=1 loadtest.js   # also POST /api/rides
```

Live web dashboard (k6 ≥ 0.49):

```powershell
$env:K6_WEB_DASHBOARD = "true"; k6 run -e SCENARIO=load loadtest.js
# open http://127.0.0.1:5665
```

## 4. Scenarios & thresholds

| Scenario | Profile | Thresholds (pass/fail) |
|---|---|---|
| `smoke` | 10 VUs / 1m | p95 < 500ms, errors < 1% |
| `load` | ramp→500, hold 5m | p95 < 500ms, p99 < 1000ms, errors < 1% |
| `stress` | 200→500→1000→1500 | p95 < 2.5s, errors < 25% (loose — finding the limit) |
| `spike` | instant 1000 | p95 < 1.5s, errors < 10% |

A non-zero exit code means a threshold failed.

## 5. How to read the results

- **`http_req_duration` p95/p99** — the headline latency. The summary lists it
  **per endpoint** (via the `name` tag), so you can see which route is slowest.
  Anything with p95 > 200ms is worth a look; > 500ms under target load is a problem.
- **`http_req_failed`** — error rate. Should be < 1% under `load`. Spikes here
  mark the breaking point in `stress`.
- **`rate_limited_429`** — fraction of sign-ups that got 429. If this is > 0,
  your numbers are polluted by the rate limiter, not real saturation.
- **`iterations` / `authenticated_requests`** — throughput (work done).
- **`vus` vs latency** — in `stress`, find the VU count where p95 latency knees
  upward and errors climb. That's your capacity ceiling on this hardware.

What to watch on the server while testing: CPU, event-loop lag, Postgres
connections/`pg` pool saturation, and Mongo connection count.

## Rate limiting

To load test without the limiter interfering, raise the caps in
`src/server.ts` (`authLimiter.max`, `apiLimiter.max`) for a local run, or gate
them behind an env var, e.g.:

```ts
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: process.env.DISABLE_RATE_LIMIT === "1" ? 1_000_000 : (isProduction ? 120 : 10000),
  // ...
});
```

then `($env:DISABLE_RATE_LIMIT=1; bun run dev)`.
