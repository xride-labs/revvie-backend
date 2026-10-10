# Curated Itineraries & Places Discovery Engine Specification

## 1. Overview & Context

This design specification establishes a comprehensive **Curated Itineraries & Places Discovery Engine** for the Revvie motorcycle ecosystem. 

Inspired by rich regional datasets from **The Loapers** (covering 200+ epic road trips, treks, and frontier forts across Karnataka and South India) and major events in the motorcycling world (such as **Motoverse** in Goa and **India Bike Week**), this system provides:
1. **Enriched Places Catalog**: High-fidelity Points of Interest (POIs) with moto-specific ratings, difficulty ratings, highway exit corridors, elevations, road conditions, and thematic tags.
2. **Curated Itinerary Engine**: Multi-tiered motorcycle routes grouped by:
   - **Departure Highway / Start Point**: Mysore Road (NH-275), Kanakapura Road (NH-978), Tumkur Road (NH-48), Hassan Road (NH-75), Airport Road (NH-4), Hosur Road (NH-48), and Old Madras Road (NH-75).
   - **Duration Tiers**: Half-day blitzes (<100 km morning detox), Full-day rides (100–300 km), Weekend escapes (300–600 km), Multi-day/Week-long tours, and 15-day Grand Expeditions (e.g. GTN, Coastal Karnataka & Konkan).
   - **Thematic Collections**: Navadurgas (9 hill forts), Seemadurgas (9 frontier sentinels), Waterbodies & dams, 30 Essential Treks, Historical/heritage ruins, and Motoworld Events (Motoverse in Goa, IBW, track events).
3. **1-Tap "Schedule as Ride" Flow**: Allows riders to convert any curated template directly into an active Revvie group or solo ride with pre-populated GPS waypoints, map preview, and ride chat.

---

## 2. Architecture & Data Model

### 2.1 Prisma Schema Updates

#### `model Place` (Enriched)
```prisma
model Place {
  id              String   @id @default(cuid())
  name            String
  address         String
  latitude        Float
  longitude       Float
  placeId         String?  @unique @map("place_id")
  icon            String?

  // Curated metadata
  rating          Float    @default(4.5)
  ratingCount     Int      @default(1) @map("rating_count")
  difficulty      String?  // 'Easy', 'Moderate', 'Challenging', 'Extreme'
  corridor        String?  // 'MYSORE_ROAD', 'KANAKAPURA_ROAD', 'TUMKUR_ROAD', 'HASSAN_ROAD', 'AIRPORT_ROAD', 'HOSUR_ROAD', 'OLD_MADRAS_ROAD'
  region          String   @default("KARNATAKA")
  category        String?  // 'FORT', 'TREK', 'WATERBODY', 'DAM', 'HERITAGE', 'VIEWPOINT', 'FOOD_STOP', 'MOTO_EVENT'
  elevation       String?  // e.g. "1,224 m"
  bestSeason      String?  @map("best_season")
  roadConditions  String?  @map("road_conditions")
  distanceFromBlr Int?     @map("distance_from_blr")
  tags            String[] @default([])
  imageUrl        String?  @map("image_url")
  description     String?  @db.Text
  isCurated       Boolean  @default(true) @map("is_curated")
  
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  savedLocations      SavedLocation[]
  itineraryWaypoints  CuratedItineraryWaypoint[]

  @@index([latitude, longitude], map: "places_lat_lng_idx")
  @@index([corridor], map: "places_corridor_idx")
  @@index([rating], map: "places_rating_idx")
  @@index([category], map: "places_category_idx")
  @@map("places")
}
```

#### `model CuratedItinerary`
```prisma
enum ItineraryTheme {
  NAVADURGAS       // The 9 hill forts around Bangalore
  SEEMADURGAS      // The 9 frontier sentinels
  WATERBODIES      // Lakes, reservoirs, dams, and waterfalls
  TREKS            // 30 Essential Treks & summits
  HISTORICAL       // Heritage, ancient forts, stone temples
  COASTAL_DRIVES   // Western Ghats, Coastal Karnataka, Konkan
  MOTO_EVENTS      // Motoverse (Goa), IBW, track events
  CHALLENGE_DOCKET // Endurance and multi-peak loops
}

enum DurationTier {
  HALF_DAY            // <100 km morning detox
  FULL_DAY            // 100 - 300 km day trip
  WEEKEND             // 300 - 600 km (2-3 days)
  EXPEDITION_WEEK     // 5-7 days
  EXPEDITION_15_DAYS  // 15 days grand expedition
  CUSTOM_DAYS         // Custom multi-day duration
}

model CuratedItinerary {
  id                 String          @id @default(cuid())
  title              String
  subtitle           String?
  description        String?         @db.Text
  slug               String          @unique
  theme              ItineraryTheme
  durationTier       DurationTier    @map("duration_tier")
  corridor           String?         // Primary departure corridor
  region             String          @default("KARNATAKA")
  distanceKm         Float           @map("distance_km")
  durationMinutes    Int             @map("duration_minutes")
  difficulty         String?         // 'Beginner', 'Intermediate', 'Advanced', 'Hardcore'
  rating             Float           @default(4.8)
  ratingCount        Int             @default(1) @map("rating_count")
  
  startLocationName  String          @map("start_location_name")
  startLat           Float           @map("start_lat")
  startLng           Float           @map("start_lng")
  endLocationName    String?         @map("end_location_name")
  endLat             Float?          @map("end_lat")
  endLng             Float?          @map("end_lng")
  
  routePolyline      String?         @db.Text @map("route_polyline")
  heroImage          String?         @map("hero_image")
  galleryImages      String[]        @default([]) @map("gallery_images")
  highlights         String[]        @default([])
  isPublished        Boolean         @default(true) @map("is_published")

  createdAt          DateTime        @default(now()) @map("created_at")
  updatedAt          DateTime        @updatedAt @map("updated_at")

  waypoints          CuratedItineraryWaypoint[]
  scheduledRides     Ride[]

  @@index([theme], map: "curated_itineraries_theme_idx")
  @@index([durationTier], map: "curated_itineraries_duration_idx")
  @@index([corridor], map: "curated_itineraries_corridor_idx")
  @@index([rating], map: "curated_itineraries_rating_idx")
  @@map("curated_itineraries")
}

model CuratedItineraryWaypoint {
  id          String   @id @default(cuid())
  itineraryId String   @map("itinerary_id")
  placeId     String?  @map("place_id")
  order       Int
  name        String
  latitude    Float
  longitude   Float
  stopType    String   @default("STOP") @map("stop_type") // START, VIEWPOINT, BASE, FOOD, FUEL, END
  notes       String?

  itinerary   CuratedItinerary @relation(fields: [itineraryId], references: [id], onDelete: Cascade)
  place       Place?            @relation(fields: [placeId], references: [id], onDelete: SetNull)

  @@index([itineraryId, order], map: "itinerary_waypoints_order_idx")
  @@map("curated_itinerary_waypoints")
}
```

#### `model Ride` (Linkage)
```prisma
  curatedItineraryId  String?  @map("curated_itinerary_id")
  curatedItinerary    CuratedItinerary? @relation(fields: [curatedItineraryId], references: [id], onDelete: SetNull)
```

---

## 3. Backend API Specification

### 3.1 `GET /api/curated-itineraries`
* **Query Parameters**:
  - `theme`: optional `ItineraryTheme`
  - `durationTier`: optional `DurationTier`
  - `corridor`: optional string (e.g. `MYSORE_ROAD`)
  - `region`: optional string (e.g. `KARNATAKA`, `GOA`)
  - `minRating`: optional number (e.g. `4.5`)
  - `page`: number (default 1), `limit`: number (default 20)
* **Response**:
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "cuid...",
          "title": "The Navadurga Circuit #1: Savandurga Fort of Death",
          "subtitle": "Asia's largest monolith via Magadi & Big Banyan Tree",
          "slug": "navadurga-savandurga",
          "theme": "NAVADURGAS",
          "durationTier": "HALF_DAY",
          "corridor": "MYSORE_ROAD",
          "distanceKm": 90,
          "durationMinutes": 180,
          "difficulty": "Moderate",
          "rating": 4.9,
          "ratingCount": 42,
          "heroImage": "https://...",
          "startLocationName": "Bangalore (Nice Road Junction)",
          "endLocationName": "Savandurga Base Camp",
          "highlights": ["Big Banyan Tree stop", "Manchinbele reservoir view", "Rock monolith climb"]
        }
      ],
      "pagination": { "page": 1, "limit": 20, "total": 35, "totalPages": 2 }
    }
  }
  ```

### 3.2 `GET /api/curated-itineraries/:id`
* **Returns**: Detailed itinerary dossier including ordered waypoints with linked `Place` records, turn-by-turn guidance, and encoded route polyline for map drawing.

### 3.3 `POST /api/curated-itineraries/:id/schedule`
* **Auth**: Required (`requireAuth`)
* **Request Body**:
  ```json
  {
    "scheduledAt": "2026-10-18T06:00:00.000Z",
    "title": "Weekend Navadurga Assault: Savandurga",
    "pace": "Moderate",
    "experienceLevel": "Intermediate",
    "isPrivate": false
  }
  ```
* **Behavior**:
  1. Loads `CuratedItinerary` with its waypoints.
  2. Creates a `Ride` row in PostgreSQL with `creatorId = req.user.id`, `curatedItineraryId = itinerary.id`, `startLocation`, `startLat`, `startLng`, `endLocation`, `endLat`, `endLng`, `distance`, `duration`, `waypoints`, and `routeData`.
  3. Creates `RideParticipant` row with role `LEADER` / status `JOINED`.
  4. Generates ride chat group.
  5. Returns created `Ride` response with 201 status code.

### 3.4 `GET /api/places/curated`
* **Query Parameters**: `corridor`, `category`, `minRating`, `region`, `tag`, `page`, `limit`.
* **Returns**: Paginated list of top-rated places matching filters with distance from Bangalore and tags.

---

## 4. Seeding & Ingestion Pipeline

### 4.1 Data Sources & Geocoding
1. **The Loapers Dataset**:
   - 150+ POIs extracted from chapters, distances, start points, navadurgas, seemadurgas, waterbodies, and historical archives.
   - Verified coordinates in Karnataka, Tamil Nadu, and Goa.
2. **Curated Itineraries Dataset**:
   - **Corridor Series**:
     - *Mysore Road Express*: Bangalore -> Kanva Reservoir -> Balmuri Falls -> KRS Backwaters (150 km)
     - *Kanakapura Waterway Run*: Bangalore -> TG Reservoir -> Mekedatu -> Chunchi Falls (110 km)
     - *Tumkur Sentinel Sprint*: Bangalore -> Nijagal Betta -> Devarayanadurga -> Namada Chilume (120 km)
     - *Airport Sunrise Dash*: Hebbal -> Nandi Hills -> Makalidurga -> Avalabetta (135 km)
     - *Old Madras Heritage Loop*: Bangalore -> Kolar Gold Fields -> Kotilingeshwara -> Antaragange (160 km)
   - **Thematic Highlights**:
     - *Navadurga Complete 9 Series*: Savandurga, Kabbaladurga, Makalidurga, Channarayanadurga, Bhairavadurga, Huthridurga, Huliyurdurga, Devarayanadurga, Nandidurga.
     - *Seemadurga Frontier 9*: Shivagange, Nijagal Betta, Bhasmangi, Midigeshi, Madhugiri monolith, Ratnagiri.
     - *Waterbody Odysseys*: Hogenekkal Falls forest route, Vanivilas Sagara (Mari Kanive Dam), Panchapalli Dam border twisties.
     - *Expeditions*:
       - *GTN Expedition* (Grand Tour of Nature): 7-Day Western Ghats & Coastal Loop (Bangalore -> Sakleshpur -> Chikmagalur -> Agumbe -> Udupi -> Gokarna -> Jog Falls -> Bangalore).
       - *Motoverse Goa Coastal Cruise*: 4-Day Bangalore -> Dandeli -> Anmod Ghat -> Vagator Goa (Motoverse festival) -> Karwar -> Bangalore.
       - *Gandikota & Belum Grand Canyon*: 2-Day Bangalore -> Lepakshi -> Belum Caves -> Gandikota Canyon.

---

## 5. Mobile Interface Integration

1. **Discovery Screen ("Curated Routes" Tab)**:
   - Highway corridor filter pills (`Mysore Rd`, `Kanakapura Rd`, `Tumkur Rd`, `Airport Rd`, `Hosur Rd`, `Old Madras Rd`).
   - Duration tabs: `Half Day (<100km)`, `Full Day`, `Weekend`, `Multi-Day`, `Events`.
   - Thematic category chips (`🏰 Navadurgas`, `🏯 Seemadurgas`, `🌊 Waterbodies`, `🏔️ Treks`, `🏍️ Moto Events`).
   - High-contrast cards with difficulty badge, road condition indicator, distance, duration, and rating star.
2. **Itinerary Dossier Screen**:
   - Interactive map route polyline preview with numbered waypoint markers.
   - Elevation profile and terrain preview.
   - Waypoints list with POI details, food stops, and scenic photo spots.
   - Sticky CTA: **"Schedule as Ride"** -> modal with date/time picker, pace, and privacy toggles.

---

## 6. Testing & Quality Invariants

1. **Unit & Integration Tests**:
   - `curated.routes.test.ts`: Tests filtering by corridor, duration tier, theme, and rating.
   - `schedule.test.ts`: Tests that scheduling an itinerary generates an active `Ride` with proper waypoints, creator, and participant status.
   - `places.curated.test.ts`: Tests querying curated places and index performance.
2. **Database Invariants**:
   - Foreign key integrity: Waypoints cascade delete on itinerary deletion, set null on place deletion.
   - Slug uniqueness: Every itinerary has a URL-safe unique slug.
   - Coordinate bounds check: Latitudes in [-90, 90], Longitudes in [-180, 180].

---
