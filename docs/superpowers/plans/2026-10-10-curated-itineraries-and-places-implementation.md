# Curated Itineraries & Places Discovery Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest 150+ POIs and 25+ curated master motorcycle itineraries from The Loapers (covering all 7 Bangalore departure highway corridors, duration tiers from half-day to 15-day expeditions, and thematic collections like Navadurgas, Seemadurgas, Waterbodies, and Motoverse), enrich Revvie's `places` table with moto ratings and metadata, and provide a 1-tap "Schedule as Ride" workflow.

**Architecture:** Extend Prisma schema with enriched `Place` attributes and new `CuratedItinerary` + `CuratedItineraryWaypoint` models. Implement a high-performance backend discovery service with multi-criteria filtering (corridor, duration, theme, rating). Build a "Schedule as Ride" converter that creates an active group/solo `Ride` populated with the curated template's waypoints and route geometry. Integrate a Curated Discovery Hub with filter pills and scheduling modal into the mobile app.

**Tech Stack:** Node.js, Express, TypeScript, Prisma (PostgreSQL), Zod, Vitest / Supertest, React Native / Expo.

**Spec:** `e:/xride-labs/revvie/backend/docs/superpowers/specs/2026-10-10-curated-itineraries-and-places-design.md`

## Global Constraints
- Target Node 20+, TypeScript 5+, Prisma 6+.
- All new database models must map snake_case column names (`@map(...)`) in PostgreSQL.
- Foreign keys must have explicit cascade or setNull rules.
- Public read endpoints (`GET /api/curated-itineraries`) must be accessible or follow auth convention with caching/indexing.
- Scheduling endpoint (`POST /api/curated-itineraries/:id/schedule`) requires user authentication.
- Distance calculations and coordinate validations must adhere to valid geo ranges (lat -90..90, lng -180..180).

## Review Focus
1. **Invalid Corridor or Theme Enum**: Querying invalid enum strings in filter query parameters returns 400 Bad Request with helpful error messages, not 500 internal server error.
2. **Scheduling Idempotency & Provenance**: Scheduling an itinerary links `curatedItineraryId` to the created `Ride`, sets status `PLANNED`, and assigns the requesting user as `LEADER` participant.
3. **Empty or Missing Waypoints**: Itineraries without linked places or waypoints must still render safely without crashing mobile map views.
4. **Coordinate Precision**: All seed coordinates and waypoints must be verified decimal floats, not strings.
5. **Seeder Idempotency**: Seeding script can be run multiple times safely using `upsert` on slugs and place unique keys without duplicate row errors.

---

### Task 1: Prisma Schema Updates & Client Generation

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Test: Prisma client validation script

**Interfaces:**
- Produces: `Place` (with `rating`, `corridor`, `region`, `category`, `elevation`, `tags`, etc.), `CuratedItinerary`, `CuratedItineraryWaypoint`, `ItineraryTheme`, `DurationTier`, and `Ride.curatedItineraryId`.

- [ ] **Step 1: Update schema.prisma with Curated models and Enriched Place**

Add `ItineraryTheme` and `DurationTier` enums, update `Place`, add `CuratedItinerary` and `CuratedItineraryWaypoint`, and update `Ride` in `backend/prisma/schema.prisma`.

- [ ] **Step 2: Run `bunx prisma generate` or `npx prisma generate`**

Verify that Prisma Client compiles cleanly and outputs TypeScript types for `CuratedItinerary` and `Place`.

- [ ] **Step 3: Create database migration or run `db push` for dev environment**

Run `bunx prisma db push` or create a migration to sync the PostgreSQL schema.

- [ ] **Step 4: Commit schema updates**

```bash
git -C backend add prisma/schema.prisma
git -C backend commit -m "feat(prisma): add curated itineraries, waypoints, and enriched place fields"
```

---

### Task 2: Data Extraction, Geocoding & Seeding Pipeline

**Files:**
- Create: `backend/src/data/loapers-curated-data.ts`
- Create: `backend/scripts/seed-curated-loapers.ts`
- Modify: `backend/prisma/seed.ts`

**Interfaces:**
- Produces: Exported typed datasets `LOAPERS_PLACES` (150+ POIs) and `LOAPERS_ITINERARIES` (25+ master routes), and runnable seeding function `seedCuratedLoapers(prisma)`.

- [ ] **Step 1: Build comprehensive seed dataset in `backend/src/data/loapers-curated-data.ts`**

Define 150+ curated places covering:
- Corridors: `MYSORE_ROAD`, `KANAKAPURA_ROAD`, `TUMKUR_ROAD`, `HASSAN_ROAD`, `AIRPORT_ROAD`, `HOSUR_ROAD`, `OLD_MADRAS_ROAD`.
- Thematic Collections:
  - 9 Navadurgas (Savandurga, Kabbaladurga, Makalidurga, Channarayanadurga, Bhairavadurga, Huthridurga, Huliyurdurga, Devarayanadurga, Nandidurga).
  - 9 Seemadurgas (Shivagange, Nijagal Betta, Bhasmangi, Midigeshi, Madhugiri, Ratnagiri, etc.).
  - Waterbodies & Dams (Mekedatu, Hogenekkal, Vanivilas Sagara, Manchinbele, Panchapalli Dam, Markonahalli Dam, etc.).
  - 30 Essential Treks & summits.
  - Moto Events (Motoverse in Goa, India Bike Week in Vagator).
- 25+ curated master itineraries spanning duration tiers: `HALF_DAY`, `FULL_DAY`, `WEEKEND`, `EXPEDITION_WEEK`, `EXPEDITION_15_DAYS`.

- [ ] **Step 2: Create `backend/scripts/seed-curated-loapers.ts`**

Write the upsert logic that iterates through `LOAPERS_PLACES`, upserts them into `Place`, then iterates through `LOAPERS_ITINERARIES`, upserts `CuratedItinerary`, and creates ordered `CuratedItineraryWaypoint` entries linking to `Place`.

- [ ] **Step 3: Test seeder execution**

Run `bun run backend/scripts/seed-curated-loapers.ts` and verify all places and itineraries are seeded without errors.

- [ ] **Step 4: Commit seeding pipeline**

```bash
git -C backend add src/data/loapers-curated-data.ts scripts/seed-curated-loapers.ts prisma/seed.ts
git -C backend commit -m "feat(seed): add loapers places and curated itineraries ingestion dataset"
```

---

### Task 3: Curated Itineraries Backend Service

**Files:**
- Create: `backend/src/services/curated/curated.service.ts`
- Create: `backend/src/services/curated/curated.service.test.ts`

**Interfaces:**
- Produces:
  - `getCuratedItineraries(filters)`
  - `getCuratedItineraryById(id)`
  - `scheduleItineraryAsRide(userId, itineraryId, options)`
  - `getCuratedPlaces(filters)`

- [ ] **Step 1: Write unit tests for `curated.service.ts`**

Test query filtering by corridor, theme, and duration, as well as the ride conversion logic.

- [ ] **Step 2: Implement `backend/src/services/curated/curated.service.ts`**

Implement database queries with Prisma, sorting by rating desc, pagination, and atomic transaction for scheduling itineraries as user rides.

- [ ] **Step 3: Run service tests and verify passing**

Run `bun test backend/src/services/curated/curated.service.test.ts`.

- [ ] **Step 4: Commit curated service**

```bash
git -C backend add src/services/curated/
git -C backend commit -m "feat(service): add curated itineraries discovery and ride scheduling service"
```

---

### Task 4: API Controllers, Validators & Routes

**Files:**
- Create: `backend/src/validators/curated.validators.ts`
- Create: `backend/src/controllers/curated.controller.ts`
- Create: `backend/src/routes/curated/curated.routes.ts`
- Modify: `backend/src/routes/index.ts`

**Interfaces:**
- Produces:
  - `GET /api/curated-itineraries`
  - `GET /api/curated-itineraries/:id`
  - `POST /api/curated-itineraries/:id/schedule`
  - `GET /api/places/curated`

- [ ] **Step 1: Create validation schemas in `curated.validators.ts`**

Define Zod schemas for query parameters (corridor, theme, durationTier, minRating, page, limit) and body for scheduling (`scheduleItinerarySchema`).

- [ ] **Step 2: Create controller in `curated.controller.ts`**

Handle HTTP requests, extract parameters, call service functions, and return `ApiResponse.success`.

- [ ] **Step 3: Create routes in `curated.routes.ts` and register in `backend/src/routes/index.ts`**

Wire endpoints to router with `validateQuery`, `validateBody`, and `requireAuth` on the schedule route.

- [ ] **Step 4: Commit controllers and routes**

```bash
git -C backend add src/validators/curated.validators.ts src/controllers/curated.controller.ts src/routes/curated/ src/routes/index.ts
git -C backend commit -m "feat(api): expose curated itineraries and places endpoints"
```

---

### Task 5: Integration Tests

**Files:**
- Create: `backend/src/routes/curated/curated.routes.test.ts`

**Interfaces:**
- Tests all 4 endpoints over HTTP with Supertest and auth tokens.

- [ ] **Step 1: Write integration tests in `curated.routes.test.ts`**

- Test filtering itineraries by `corridor=MYSORE_ROAD`.
- Test filtering itineraries by `durationTier=HALF_DAY`.
- Test filtering itineraries by `theme=NAVADURGAS`.
- Test `GET /api/curated-itineraries/:id` returns ordered waypoints and polyline.
- Test `POST /api/curated-itineraries/:id/schedule` creates active `Ride` and returns 201.
- Test `GET /api/places/curated?corridor=KANAKAPURA_ROAD`.

- [ ] **Step 2: Run test suite**

Run `bun test backend/src/routes/curated/curated.routes.test.ts`. Verify all tests pass.

- [ ] **Step 3: Commit integration tests**

```bash
git -C backend add src/routes/curated/curated.routes.test.ts
git -C backend commit -m "test(curated): add integration tests for curated routes and scheduling"
```

---

### Task 6: Mobile Client Discovery & Scheduling Integration

**Files:**
- Create: `mobile/src/services/curated.service.ts`
- Create: `mobile/src/components/discovery/CuratedRoutesHub.tsx`
- Create: `mobile/src/components/discovery/ItineraryDetailSheet.tsx`
- Modify: `mobile/src/screens/DiscoveryScreen.tsx` or equivalent Explore view

**Interfaces:**
- Produces: Interactive curated discovery carousel with highway corridor pills, duration tabs, themed collection cards, route detail view with map line preview, and "Schedule as Ride" modal.

- [ ] **Step 1: Create `mobile/src/services/curated.service.ts`**

Define API client methods: `fetchCuratedItineraries`, `fetchCuratedItineraryDetails`, `scheduleItinerary`, `fetchCuratedPlaces`.

- [ ] **Step 2: Create `CuratedRoutesHub.tsx`**

Build responsive UI with:
- Highway pills: `Mysore Rd`, `Kanakapura Rd`, `Tumkur Rd`, `Airport Rd`, `Hosur Rd`, `Old Madras Rd`.
- Duration tabs: `Half Day`, `Full Day`, `Weekend`, `Multi-Day`, `Events`.
- Thematic badges: `Navadurgas 🏰`, `Waterbodies 🌊`, `Treks 🏔️`, `Motoverse 🏍️`.
- High-contrast cards with rating stars, difficulty badge, and distance.

- [ ] **Step 3: Create `ItineraryDetailSheet.tsx` with "Schedule as Ride" modal**

Build bottom sheet/modal with route waypoint stops, road advisory, and 1-tap "Schedule as Ride" button with date-picker that calls backend and navigates to the created ride.

- [ ] **Step 4: Commit mobile components**

```bash
git -C mobile add src/services/curated.service.ts src/components/discovery/
git -C mobile commit -m "feat(mobile): add curated routes discovery hub and scheduling bottom sheet"
```

---
