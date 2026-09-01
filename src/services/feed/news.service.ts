/**
 * Motorcycle News & Editorial Aggregation Service
 *
 * Fetches, normalizes, and caches daily motorcycle news, reviews, and custom
 * builds from official RSS syndication feeds — organized in three tiers:
 *
 *   1. DOMESTIC  — Regional / city-level motorcycle publications
 *   2. NATIONAL  — Country-wide motorcycle news (Google News, national outlets)
 *   3. INTERNATIONAL — Global editorial (RideApart, Bike EXIF, Asphalt & Rubber)
 *
 * Key Architecture Decisions:
 * 1. ZERO CRAWLERS: Uses official RSS/XML feeds provided by publishers for syndication.
 * 2. NO BOT BANS / SERVER CACHE: In-memory cache with 1-hour TTL ensures external
 *    feeds are requested at most once per hour regardless of user volume.
 * 3. LOCATION-AWARE: Integrates regional motorcycle news based on the rider's country/coordinates.
 * 4. GRACEFUL RESILIENCE: 4s timeout per feed + curated fallback stories ensure the carousel
 *    is never blank or broken even if offline or upstream feeds fail.
 * 5. SMART IMAGE EXTRACTION: Tries enclosure, media:content, media:thumbnail,
 *    content:encoded <img>, description <img>, and og:image fetch as last resort.
 */

import { fetchFeedSafe, fetchOgImage } from "../../lib/rssClient.js";

export interface MotoArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  imageUrl: string;
  source: string;
  category: "News" | "Customs" | "Reviews" | "Racing" | "Culture" | "Gear";
  /** Priority tier — lower = higher precedence. 0 = domestic, 1 = national, 2 = international */
  tier: number;
  publishedAt: string;
  readTimeMinutes: number;
}

interface CacheEntry {
  items: MotoArticle[];
  cachedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, CacheEntry>();

// ── Feed Source Definition ────────────────────────────────────────────────────
interface FeedSource {
  url: string;
  sourceName: string;
  category: MotoArticle["category"];
  /** 0 = domestic, 1 = national, 2 = international */
  tier: number;
}

// ── Country-specific domestic & national feeds ────────────────────────────────
const DOMESTIC_FEEDS: Record<string, FeedSource[]> = {
  IN: [
    // Indian motorcycle publications — RSS/Atom feeds
    { url: "https://www.zigwheels.com/news/bike-news/feed", sourceName: "ZigWheels", category: "News", tier: 0 },
    { url: "https://www.bikewale.com/rss/news.xml", sourceName: "BikeWale", category: "News", tier: 0 },
    { url: "https://www.autocarindia.com/bikes/rss", sourceName: "Autocar India", category: "Reviews", tier: 0 },
    { url: "https://www.rushlane.com/feed", sourceName: "Rushlane", category: "News", tier: 0 },
    { url: "https://www.motorbeam.com/feed", sourceName: "MotorBeam", category: "Reviews", tier: 0 },
    { url: "https://www.thrustzone.com/feed", sourceName: "ThrustZone", category: "Reviews", tier: 0 },
    { url: "https://www.drivespark.com/rss/two-wheelers-feed.xml", sourceName: "DriveSpark", category: "News", tier: 0 },
  ],
  US: [
    { url: "https://www.motorcycle.com/blog/feed", sourceName: "Motorcycle.com", category: "News", tier: 0 },
    { url: "https://www.revzilla.com/common-tread/feed", sourceName: "RevZilla", category: "Culture", tier: 0 },
    { url: "https://www.cycleworld.com/feed/", sourceName: "Cycle World", category: "Reviews", tier: 0 },
    { url: "https://www.ridermagazine.com/feed/", sourceName: "Rider Mag", category: "Culture", tier: 0 },
  ],
  GB: [
    { url: "https://www.motorcyclenews.com/feed/", sourceName: "MCN", category: "News", tier: 0 },
    { url: "https://www.visordown.com/feed", sourceName: "Visordown", category: "News", tier: 0 },
    { url: "https://www.bennetts.co.uk/bikesocial/feed", sourceName: "BikeSocial", category: "Reviews", tier: 0 },
  ],
  AU: [
    { url: "https://www.mcnews.com.au/feed/", sourceName: "MCNews AU", category: "News", tier: 0 },
  ],
};

// Google News national tier — per-country motorcycle topics
function getNationalFeeds(regionCode: string): FeedSource[] {
  const queries: Record<string, string> = {
    IN: "motorcycle+bike+launch+India",
    US: "motorcycle+news+reviews",
    GB: "motorcycle+UK+news",
    AU: "motorcycle+Australia+news",
  };
  const query = queries[regionCode] || "motorcycle+news";
  return [
    {
      url: `https://news.google.com/rss/search?q=${query}&hl=en-${regionCode}&gl=${regionCode}&ceid=${regionCode}:en`,
      sourceName: regionCode === "IN" ? "Moto India" : regionCode === "GB" ? "Moto UK" : "Moto Dispatch",
      category: "News",
      tier: 1,
    },
  ];
}

// International editorial feeds — always included
const INTERNATIONAL_FEEDS: FeedSource[] = [
  { url: "https://www.rideapart.com/rss/articles/all/", sourceName: "RideApart", category: "News", tier: 2 },
  { url: "https://www.bikeexif.com/feed", sourceName: "Bike EXIF", category: "Customs", tier: 2 },
  { url: "https://www.asphaltandrubber.com/feed/", sourceName: "Asphalt & Rubber", category: "Racing", tier: 2 },
  { url: "https://newatlas.com/motorcycles/rss/", sourceName: "New Atlas", category: "Reviews", tier: 2 },
];

// Curated evergreen fallback articles if external feeds are temporarily unreachable
const FALLBACK_ARTICLES: MotoArticle[] = [
  {
    id: "fb-1",
    title: "The Golden Era of Scramblers: Why Riders Love Minimalist Dual-Sports",
    summary: "From retro air-cooled thumpers to modern high-clearance twins, the scrambler resurgence is reshaping weekend adventure riding.",
    url: "https://www.bikeexif.com",
    imageUrl: "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?q=80&w=800&auto=format&fit=crop",
    source: "Bike EXIF",
    category: "Customs",
    tier: 2,
    publishedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    readTimeMinutes: 4,
  },
  {
    id: "fb-2",
    title: "Cornering Precision: Mastering Countersteering and Body English on Canyon Carvers",
    summary: "A deep dive into apex speed, trail braking safely, and setting your lines for maximum stability and fun.",
    url: "https://www.rideapart.com",
    imageUrl: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?q=80&w=800&auto=format&fit=crop",
    source: "RideApart",
    category: "Reviews",
    tier: 2,
    publishedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    readTimeMinutes: 5,
  },
  {
    id: "fb-3",
    title: "Essential Adventure Touring Gear: Surviving 1,000-Mile Journeys in All Weather",
    summary: "Layering techniques, hydration packs, puncture repair kits, and luggage systems tested on grueling backcountry discovery routes.",
    url: "https://www.asphaltandrubber.com",
    imageUrl: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?q=80&w=800&auto=format&fit=crop",
    source: "Asphalt & Rubber",
    category: "Gear",
    tier: 2,
    publishedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
    readTimeMinutes: 6,
  },
  {
    id: "fb-4",
    title: "Next-Gen Middleweights: The 650cc-800cc Segment Taking Over the Market",
    summary: "Manufacturers are hitting the sweet spot of approachable torque, lightweight chassis, and sub-100hp usability.",
    url: "https://www.rideapart.com",
    imageUrl: "https://images.unsplash.com/photo-1558980664-769d59546b3d?q=80&w=800&auto=format&fit=crop",
    source: "RideApart",
    category: "News",
    tier: 2,
    publishedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    readTimeMinutes: 3,
  },
];
// RSS Feed fetching has been extracted to rssClient.ts

// ── Fallback category images (only used when og:image also fails) ─────────────
const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  News: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?q=80&w=800&auto=format&fit=crop",
  Customs: "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?q=80&w=800&auto=format&fit=crop",
  Reviews: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?q=80&w=800&auto=format&fit=crop",
  Racing: "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?q=80&w=800&auto=format&fit=crop",
  Culture: "https://images.unsplash.com/photo-1558980664-769d59546b3d?q=80&w=800&auto=format&fit=crop",
  Gear: "https://images.unsplash.com/photo-1558981359-219d6364c9c8?q=80&w=800&auto=format&fit=crop",
};

// ── Main Public Entrypoint ────────────────────────────────────────────────────

/**
 * Fetch dynamic motorcycle news, customized by location.
 *
 * Articles are returned in priority order:
 *   1. Domestic (tier 0) — regional/city-level publications
 *   2. National (tier 1) — country-wide motorcycle news
 *   3. International (tier 2) — global editorial
 *
 * Within each tier, articles are sorted freshest-first.
 */
/**
 * Core business logic for aggregating, deduping, and formatting news.
 * External data is provided by passing down the resolved region.
 */
async function fetchAndProcessNews(
  region: { code: string; name: string }
): Promise<MotoArticle[]> {
  const feedsToFetch: FeedSource[] = [
    ...(DOMESTIC_FEEDS[region.code] || []),
    ...getNationalFeeds(region.code),
    ...INTERNATIONAL_FEEDS,
  ];

  const results = await Promise.allSettled(
    feedsToFetch.map((f) => fetchFeedSafe(f)),
  );

  const aggregated: MotoArticle[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      aggregated.push(...r.value);
    }
  }

  let finalItems: MotoArticle[] = [];
  if (aggregated.length > 0) {
    const seenTitles = new Set<string>();
    const seenUrls = new Set<string>();

    for (const item of aggregated) {
      const normalizedTitle = item.title.toLowerCase().slice(0, 40);
      if (!seenTitles.has(normalizedTitle) && !seenUrls.has(item.url)) {
        seenTitles.add(normalizedTitle);
        seenUrls.add(item.url);
        finalItems.push(item);
      }
    }

    finalItems.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  }

  const noImageItems = finalItems.filter((item) => !item.imageUrl);
  if (noImageItems.length > 0) {
    const ogBatch = noImageItems.slice(0, 8);
    const ogResults = await Promise.allSettled(
      ogBatch.map((item) => fetchOgImage(item.url)),
    );
    for (let i = 0; i < ogBatch.length; i++) {
      const result = ogResults[i];
      if (result.status === "fulfilled" && result.value) {
        ogBatch[i].imageUrl = result.value;
      }
    }
  }

  for (const item of finalItems) {
    if (!item.imageUrl) {
      item.imageUrl = CATEGORY_FALLBACK_IMAGES[item.category] || CATEGORY_FALLBACK_IMAGES.News;
    }
  }

  if (finalItems.length === 0) {
    finalItems = [...FALLBACK_ARTICLES];
  }

  return finalItems;
}

/** Detect country code from coordinates (bounding box heuristics) */
function resolveCountry(lat?: number, lng?: number, requestedCountry?: string): { code: string; name: string } {
  if (requestedCountry && requestedCountry.length === 2) {
    return { code: requestedCountry.toUpperCase(), name: requestedCountry.toUpperCase() };
  }

  if (lat != null && lng != null) {
    if (lat >= 8.0 && lat <= 37.5 && lng >= 68.0 && lng <= 97.5) return { code: "IN", name: "India" };
    if (lat >= 49.8 && lat <= 60.9 && lng >= -8.5 && lng <= 1.8) return { code: "GB", name: "United Kingdom" };
    if (lat >= 24.5 && lat <= 49.4 && lng >= -125.0 && lng <= -66.9) return { code: "US", name: "United States" };
    if (lat >= -44.0 && lat <= -10.0 && lng >= 112.0 && lng <= 154.0) return { code: "AU", name: "Australia" };
  }

  return { code: "US", name: "Global" };
}

/**
 * Higher-order function/wrapper for caching.
 * Keeps business logic clean of cache.get / cache.set.
 */
async function getCachedMotorcycleNews(params?: {
  lat?: number;
  lng?: number;
  country?: string;
  limit?: number;
}): Promise<{ items: MotoArticle[]; region: string; updatedAt: string }> {
  const limit = Math.min(25, Math.max(4, params?.limit ?? 12));
  const region = resolveCountry(params?.lat, params?.lng, params?.country);
  const cacheKey = `news_${region.code}`;

  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return {
      items: cached.items.slice(0, limit),
      region: region.name,
      updatedAt: new Date(cached.cachedAt).toISOString(),
    };
  }

  const finalItems = await fetchAndProcessNews(region);

  cache.set(cacheKey, {
    items: finalItems,
    cachedAt: now,
  });

  return {
    items: finalItems.slice(0, limit),
    region: region.name,
    updatedAt: new Date(now).toISOString(),
  };
}

export async function getMotorcycleNews(params?: {
  lat?: number;
  lng?: number;
  country?: string;
  limit?: number;
}): Promise<{ items: MotoArticle[]; region: string; updatedAt: string }> {
  return getCachedMotorcycleNews(params);
}

export const newsService = {
  getMotorcycleNews,
};
