/**
 * Motorcycle News & Editorial Aggregation Service
 *
 * Fetches, normalizes, and caches daily motorcycle news, reviews, and custom
 * builds from official RSS syndication feeds (RideApart, Bike EXIF, Asphalt & Rubber,
 * and regional Google News topics).
 *
 * Key Architecture Decisions:
 * 1. ZERO CRAWLERS: Uses official RSS/XML feeds provided by publishers for syndication.
 * 2. NO BOT BANS / SERVER CACHE: In-memory cache with 1-hour TTL ensures external
 *    feeds are requested at most once per hour regardless of user volume.
 * 3. LOCATION-AWARE: Integrates regional motorcycle news based on the rider's country/coordinates.
 * 4. GRACEFUL RESILIENCE: 4s timeout per feed + curated fallback stories ensure the carousel
 *    is never blank or broken even if offline or upstream feeds fail.
 */

export interface MotoArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  imageUrl: string;
  source: string;
  category: "News" | "Customs" | "Reviews" | "Racing" | "Culture" | "Gear";
  publishedAt: string;
  readTimeMinutes: number;
}

interface CacheEntry {
  items: MotoArticle[];
  cachedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, CacheEntry>();

// Fallback high-res imagery by category when feed lacks image enclosure
const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  News: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?q=80&w=800&auto=format&fit=crop",
  Customs: "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?q=80&w=800&auto=format&fit=crop",
  Reviews: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?q=80&w=800&auto=format&fit=crop",
  Racing: "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?q=80&w=800&auto=format&fit=crop",
  Culture: "https://images.unsplash.com/photo-1558980664-769d59546b3d?q=80&w=800&auto=format&fit=crop",
  Gear: "https://images.unsplash.com/photo-1558981359-219d6364c9c8?q=80&w=800&auto=format&fit=crop",
};

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
    publishedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    readTimeMinutes: 3,
  },
];

/** Clean raw HTML entities and tags into readable plaintext */
function cleanText(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse an RSS/XML string into normalized MotoArticle items */
function parseRss(
  xml: string,
  sourceName: string,
  category: MotoArticle["category"],
): MotoArticle[] {
  const items: MotoArticle[] = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const itemXml of itemMatches) {
    const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);
    const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const descMatch = itemXml.match(/<description>([\s\S]*?)<\/description>/i);
    const encMatch = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
    const mediaMatch = itemXml.match(/<media:(?:content|thumbnail)[^>]+url=["']([^"']+)["']/i);
    const imgMatch = descMatch ? descMatch[1].match(/<img[^>]+src=["']([^"']+)["']/i) : null;

    const title = titleMatch ? cleanText(titleMatch[1]) : "";
    let link = linkMatch ? cleanText(linkMatch[1]) : "";
    const rawDesc = descMatch ? cleanText(descMatch[1]) : "";
    const extractedImage = encMatch ? encMatch[1] : mediaMatch ? mediaMatch[1] : imgMatch ? imgMatch[1] : null;

    // Filter out invalid/empty titles or non-http links
    if (!title || !link || !link.startsWith("http")) continue;

    // Extract publisher name from <source> tag if present (e.g. from Google News)
    const sourceTagMatch = itemXml.match(/<source[^>]*>([^<]+)<\/source>/i);
    const resolvedSource = sourceTagMatch?.[1]?.trim() || sourceName;

    const pubDate = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();
    const validPubDate = isNaN(pubDate.getTime()) ? new Date().toISOString() : pubDate.toISOString();

    items.push({
      id: Buffer.from(link).toString("base64").slice(0, 20),
      title,
      summary: rawDesc.slice(0, 160) || "Read the latest story and insights from the motorcycling community.",
      url: link,
      imageUrl: extractedImage || CATEGORY_FALLBACK_IMAGES[category] || CATEGORY_FALLBACK_IMAGES.News,
      source: resolvedSource,
      category,
      publishedAt: validPubDate,
      readTimeMinutes: Math.max(2, Math.min(8, Math.round(rawDesc.split(/\s+/).length / 35))),
    });
  }

  return items;
}

/** Detect country code from coordinates (bounding box heuristics) */
function resolveCountry(lat?: number, lng?: number, requestedCountry?: string): { code: string; name: string } {
  if (requestedCountry && requestedCountry.length === 2) {
    return { code: requestedCountry.toUpperCase(), name: requestedCountry.toUpperCase() };
  }

  if (lat != null && lng != null) {
    // India bounds: Lat 8.0 - 37.5, Lng 68.0 - 97.5
    if (lat >= 8.0 && lat <= 37.5 && lng >= 68.0 && lng <= 97.5) {
      return { code: "IN", name: "India" };
    }
    // UK bounds: Lat 49.8 - 60.9, Lng -8.5 - 1.8
    if (lat >= 49.8 && lat <= 60.9 && lng >= -8.5 && lng <= 1.8) {
      return { code: "GB", name: "United Kingdom" };
    }
    // US bounds: Lat 24.5 - 49.4, Lng -125.0 - -66.9
    if (lat >= 24.5 && lat <= 49.4 && lng >= -125.0 && lng <= -66.9) {
      return { code: "US", name: "United States" };
    }
  }

  // Default to global/US
  return { code: "US", name: "Global" };
}

/** Fetch a single feed with timeout protection */
async function fetchFeedSafe(
  url: string,
  sourceName: string,
  category: MotoArticle["category"],
): Promise<MotoArticle[]> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "RevvieApp/1.0 (+https://revvie.app; motorcycle community feed reader)",
        Accept: "application/rss+xml, application/xml, text/xml; q=0.9, */*; q=0.8",
      },
      signal: AbortSignal.timeout(4500),
    });

    if (!res.ok) {
      console.warn(`[NewsService] Feed ${sourceName} returned status ${res.status}`);
      return [];
    }

    const xml = await res.text();
    return parseRss(xml, sourceName, category);
  } catch (err: any) {
    console.warn(`[NewsService] Error fetching ${sourceName}:`, err?.message || err);
    return [];
  }
}

/**
 * Main public entrypoint: Fetch dynamic motorcycle news, customized by location
 */
export async function getMotorcycleNews(params?: {
  lat?: number;
  lng?: number;
  country?: string;
  limit?: number;
}): Promise<{ items: MotoArticle[]; region: string; updatedAt: string }> {
  const limit = Math.min(25, Math.max(4, params?.limit ?? 12));
  const region = resolveCountry(params?.lat, params?.lng, params?.country);
  const cacheKey = `news_${region.code}`;

  // 1. Check in-memory cache
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return {
      items: cached.items.slice(0, limit),
      region: region.name,
      updatedAt: new Date(cached.cachedAt).toISOString(),
    };
  }

  // 2. Build RSS feeds to query concurrently
  const feedsToFetch: Array<{ url: string; sourceName: string; category: MotoArticle["category"] }> = [
    // Global Editorial
    {
      url: "https://www.rideapart.com/rss/articles/all/",
      sourceName: "RideApart",
      category: "News",
    },
    {
      url: "https://www.bikeexif.com/feed",
      sourceName: "Bike EXIF",
      category: "Customs",
    },
    {
      url: "https://www.asphaltandrubber.com/feed/",
      sourceName: "Asphalt & Rubber",
      category: "Racing",
    },
  ];

  // Add Location-specific Google News RSS
  const queryTerm = region.code === "IN" ? "motorcycles+bikes+launch" : "motorcycle+news+reviews";
  feedsToFetch.push({
    url: `https://news.google.com/rss/search?q=${queryTerm}&hl=en-${region.code}&gl=${region.code}&ceid=${region.code}:en`,
    sourceName: region.code === "IN" ? "Moto India" : "Moto Dispatch",
    category: "News",
  });

  // 3. Fetch all feeds in parallel
  const results = await Promise.allSettled(
    feedsToFetch.map((f) => fetchFeedSafe(f.url, f.sourceName, f.category)),
  );

  const aggregated: MotoArticle[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      aggregated.push(...r.value);
    }
  }

  // 4. If upstream feeds returned items, deduplicate and sort by date
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

    // Sort by publication date desc (freshest first)
    finalItems.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  // 5. If everything failed (e.g. offline dev environment), fall back to curated stories
  if (finalItems.length === 0) {
    finalItems = [...FALLBACK_ARTICLES];
  }

  // 6. Cache the result
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

export const newsService = {
  getMotorcycleNews,
};
