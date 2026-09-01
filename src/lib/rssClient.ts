import { MotoArticle } from "../services/feed/news.service.js";

interface FeedSource {
  url: string;
  sourceName: string;
  category: MotoArticle["category"];
  tier: number;
}

function cleanUrl(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|avif|svg)/i.test(url) || /image/i.test(url);
}

function extractImage(itemXml: string): string | null {
  const enc = itemXml.match(/<enclosure[^>]+type=["']image\/[^"']+["'][^>]+url=["']([^"']+)["']/i)
    ?? itemXml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i)
    ?? itemXml.match(/<enclosure[^>]+url=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
  if (enc?.[1]) return cleanUrl(enc[1]);

  const mediaContent = itemXml.match(/<media:content[^>]+url=["']([^"']+)["']/i);
  if (mediaContent?.[1] && isImageUrl(mediaContent[1])) return cleanUrl(mediaContent[1]);

  const mediaThumbnail = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (mediaThumbnail?.[1]) return cleanUrl(mediaThumbnail[1]);

  const imageUrl = itemXml.match(/<image>\s*<url>([^<]+)<\/url>/i);
  if (imageUrl?.[1]) return cleanUrl(imageUrl[1]);

  const contentEncoded = itemXml.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i);
  if (contentEncoded) {
    const imgInContent = contentEncoded[1].match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgInContent?.[1]) return cleanUrl(imgInContent[1]);
  }

  const desc = itemXml.match(/<description>([\s\S]*?)<\/description>/i);
  if (desc) {
    const imgInDesc = desc[1].match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgInDesc?.[1]) return cleanUrl(imgInDesc[1]);
  }

  return null;
}

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

export async function fetchOgImage(articleUrl: string): Promise<string | null> {
  try {
    const res = await fetch(articleUrl, {
      headers: {
        "User-Agent": "RevvieApp/1.0 (+https://revvie.app; open graph prefetch)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(2500),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    let html = "";
    const decoder = new TextDecoder();
    while (html.length < 32768) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});

    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return ogMatch?.[1] || null;
  } catch {
    return null;
  }
}

function parseRss(
  xml: string,
  sourceName: string,
  category: MotoArticle["category"],
  tier: number,
): MotoArticle[] {
  const items: MotoArticle[] = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const itemXml of itemMatches) {
    const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);
    const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const descMatch = itemXml.match(/<description>([\s\S]*?)<\/description>/i);

    const title = titleMatch ? cleanText(titleMatch[1]) : "";
    const link = linkMatch ? cleanText(linkMatch[1]) : "";
    const rawDesc = descMatch ? cleanText(descMatch[1]) : "";
    const imageUrl = extractImage(itemXml);

    if (!title || !link || !link.startsWith("http")) continue;

    const sourceTagMatch = itemXml.match(/<source[^>]*>([^<]+)<\/source>/i);
    const resolvedSource = sourceTagMatch?.[1]?.trim() || sourceName;

    const pubDate = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();
    const validPubDate = isNaN(pubDate.getTime()) ? new Date().toISOString() : pubDate.toISOString();

    items.push({
      id: Buffer.from(link).toString("base64"),
      title,
      summary: rawDesc.slice(0, 160) || "Read the latest story and insights from the motorcycling community.",
      url: link,
      imageUrl: imageUrl || "",
      source: resolvedSource,
      category,
      tier,
      publishedAt: validPubDate,
      readTimeMinutes: Math.max(2, Math.min(8, Math.round(rawDesc.split(/\s+/).length / 35))),
    });
  }

  return items;
}

export async function fetchFeedSafe(feed: FeedSource): Promise<MotoArticle[]> {
  try {
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": "RevvieApp/1.0 (+https://revvie.app; motorcycle community feed reader)",
        Accept: "application/rss+xml, application/xml, text/xml; q=0.9, */*; q=0.8",
      },
      signal: AbortSignal.timeout(4500),
    });

    if (!res.ok) {
      console.warn(`[NewsService] Feed ${feed.sourceName} returned status ${res.status}`);
      return [];
    }

    const xml = await res.text();
    return parseRss(xml, feed.sourceName, feed.category, feed.tier);
  } catch (err: any) {
    console.warn(`[NewsService] Error fetching ${feed.sourceName}:`, err?.message || err);
    return [];
  }
}

export type { FeedSource };
