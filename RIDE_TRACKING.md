# Ride tracking — backend

Server side of the app's core feature. For the mobile/GPS/navigation side,
see `RIDE_TRACKING.md` at the root of the `mobile` repo — this doc covers
what lives here: the ride lifecycle, telemetry ingestion, and everything in
[`src/lib/socket.ts`](src/lib/socket.ts) that makes group tracking, safety
alerts, calling, and radio work in real time.

## 1. Ride lifecycle

`Ride.status` moves `PLANNED → IN_PROGRESS → (PAUSED ↔ IN_PROGRESS) →
COMPLETED` (or `CANCELLED`). The relevant routes live in
[`src/routes/ride/ride.routes.ts`](src/routes/ride/ride.routes.ts):

- `POST /:id/tracking` — periodic telemetry upsert during the ride
  (position, speed, distance so far). Idempotent under retry: it tries a
  `create` first and falls back to an atomic claimed `update` on a unique
  constraint conflict, so a client retrying an in-flight request can't
  double-count distance/XP.
- `POST /:id/end` — atomically claims the ride via a guarded `updateMany`
  (`status NOT IN (COMPLETED, CANCELLED)`) inside the transaction, not a
  plain `update`, so two concurrent end requests (double-tap, or a client
  retry racing the original) can't both run the summary/XP/badge logic —
  only one wins the race; the other gets a 409. See
  `rideEndRace.test.ts` for the concurrency test.
- `POST /:id/lead` — creator-only, reassigns the group ride lead, broadcasts
  `ride_lead_changed` via the socket layer.

Post-ride, [`src/services/ride-summary.service.ts`](src/services/ride-summary.service.ts)
computes distance/speed/score/highlights/badges once, snapshotted onto
`RideSummary` and never recomputed — so a later change to scoring weights
doesn't retroactively change a past ride's badges.

## 2. Real-time layer (`socket.ts`)

Everything in this section is one Socket.IO server (`createSocketServer`),
one ride room per ride (`ride:{rideId}`), authenticated via the same
better-auth session the REST API uses.

### Rider location cache

`rideRiderCache` (in-memory, mirrored to Redis when `REDIS_URL` is set) holds
the last-known position of every rider currently in a live ride, so a late
joiner gets everyone's position immediately via the `join_ride_tracking` ack
instead of waiting for the next broadcast. Every write to this cache is a
choke point several other systems key off — see below.

### Authorization

`isRideParticipant(rideId, userId)` gates `join_ride_tracking`,
`trigger_emergency`, `call:invite`, and `radio:start` — without it, any
authenticated user who obtained a rideId (shared link, screenshot, guessed
ID) could join a stranger's ride room, read their live location, spam a
fabricated SOS, or ring/radio a rider they have no relationship to.

### Group cohesion + rider-health detection

Two signals that only make sense with more than one rider on the ride,
both keyed off the same rider-location cache every location update already
writes to:

- **Falling behind** (`evaluateGroupCohesion`, called right after every
  cache write) — computes the centroid of every *other* recently-cached
  rider's position and flags a rider whose distance from it exceeds
  `FALLING_BEHIND_ENTER_M` (2km), sustained for `FALLING_BEHIND_SUSTAINED_MS`
  (45s) to avoid firing on a single noisy fix. Recovery uses a lower
  `FALLING_BEHIND_EXIT_M` (1.2km) threshold (hysteresis, so a rider sitting
  right at the boundary doesn't flap alerts back and forth). Emits
  `rider_falling_behind` / `rider_back_on_track` to the ride room.
- **Unresponsive** (`sweepUnresponsiveRiders`, a periodic interval, not a
  per-update check) — flags a rider whose cached position hasn't updated in
  `UNRESPONSIVE_THRESHOLD_MS` (45s) despite their socket still being
  connected. Distinct from a hard disconnect, which the `disconnect` handler
  already cleans up immediately and separately — this catches a stalled GPS,
  a frozen app, or a screen-locked phone without background-location
  permission. Emits `rider_unresponsive` / `rider_responsive_again`.

Both thresholds are shortened under `NODE_ENV=test` (see the `IS_TEST` gate
in `socket.ts`) so the test suite doesn't need real 45-second waits — same
pattern `server.ts` already uses to skip starting a live server in tests.

**Known limitation**: both read the in-memory cache directly (not the
Redis-preferring `getCachedRiders` path other code uses for the
authoritative late-joiner snapshot) to avoid a Redis round-trip on every
single location tick. On a genuinely horizontally-scaled deployment, a
rider whose latest ping landed on a different instance than the one running
a given check introduces a small staleness window. Acceptable for a
soft-realtime UX signal; would need to move onto Redis-backed state to be
fully correct across instances.

### Group radio (push-to-talk broadcast)

`radio:start` / `radio:audio` / `radio:cancel` — closes the gap where
"radio calls" would otherwise mean the same 1:1 call signaling below,
which doesn't fit a "everyone should hear this" use case. One rider holds
the ride's channel at a time (`radioBusyByRide`, a simple in-memory lock,
not persisted — a radio transmission isn't meant to be a durable record the
way a chat message is): `radio:start` grants the lock and notifies the room,
`radio:audio` relays the finished base64-encoded clip to everyone else and
releases the lock, `radio:cancel` releases without broadcasting. A
`RADIO_MAX_HOLD_MS` (20s) server-side safety timer and the existing
disconnect-cleanup path both release an abandoned lock so one dropped
connection can't permanently jam the channel for the rest of the group.

### P2P calling

1:1 signaling only (`call:invite`/`respond`/`signal`/`end`) — relays
SDP/ICE between two sockets, actual audio is peer-to-peer once connected. A
TURN relay is required in front of this for callers behind carrier-grade
NAT (the common case on cellular data) — that's deployment/infra
configuration, not something this signaling layer handles itself.
`activeCallsByUser` tracks ringing/active calls per userId so either side's
disconnect can find and notify the other.

### SOS

`trigger_emergency` broadcasts to the ride room immediately, then
(after the ack, so it never blocks the sender's UI) persists a
`Notification` row and pushes every other participant regardless of online
status or notification preferences — SOS is the one thing in this app that
intentionally bypasses those.

## 3. Group Ride Report

`rideEventCounters` (in `socket.ts`) tallies how many times SOS fired and
how many times each rider-health signal transitioned into its alerted state,
over a ride's entire lifetime. `getRideEventCounters`/`clearRideEventCounters`
are the two exported hooks: `/:id/end` reads the tally into the
`RideSummary` row it's already writing (`sosCount`, `fallingBehindEvents`,
`unresponsiveEvents`), then clears it — so this in-memory state never
outlives the ride it belongs to.

## 4. Testing

Real Socket.IO integration tests, not mocks —
[`src/test/socketTestServer.ts`](src/test/socketTestServer.ts) boots the
actual `createSocketServer` on an ephemeral port and connects real
`socket.io-client` instances authenticated through the same better-auth test
mock the REST tests use. Relevant suites:

- `groupRideTracking.test.ts` — multi-socket location broadcast, late-joiner
  snapshot, disconnect cleanup, membership authorization.
- `groupCohesion.test.ts` — falling-behind + unresponsive detection and
  recovery.
- `rideRadio.test.ts` — channel lock lifecycle (grant, busy, release via
  audio/cancel/disconnect), authorization.
- `emergencySignaling.test.ts` — SOS broadcast + notification persistence +
  authorization.
- `callSignaling.test.ts` — 1:1 call invite/respond/signal/end.
- `groupRideReport.test.ts` — the tallies above actually land on
  `RideSummary` and get cleared after.
- `clubRideSimulation.test.ts` — a full 60-rider simulation exercising all
  of the above together against the real stack, used as a load/edge-case
  smoke test rather than asserting fine-grained behavior (that's what the
  suites above are for).
