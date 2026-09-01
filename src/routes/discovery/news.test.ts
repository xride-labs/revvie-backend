import { describe, it, expect } from "vitest";
import { getMotorcycleNews, MotoArticle } from "../../services/news.service.js";

describe("Motorcycle News Service", () => {
  it("fetches and returns a list of motorcycle articles", async () => {
    const result = await getMotorcycleNews({ limit: 6 });

    expect(result).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.region).toBeDefined();
    expect(result.updatedAt).toBeDefined();

    const first = result.items[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("title");
    expect(first).toHaveProperty("url");
    expect(first).toHaveProperty("imageUrl");
    expect(first).toHaveProperty("source");
    expect(first).toHaveProperty("category");
    expect(first).toHaveProperty("publishedAt");
    expect(first).toHaveProperty("readTimeMinutes");
    expect(first).toHaveProperty("tier");
    expect(first.title.length).toBeGreaterThan(5);
    expect(first.url.startsWith("http")).toBe(true);
    expect(first.imageUrl.startsWith("http")).toBe(true);
  });

  it("resolves region appropriately for Indian coordinates", async () => {
    // Coordinates for Bangalore, India: 12.9716, 77.5946
    const result = await getMotorcycleNews({ lat: 12.9716, lng: 77.5946, limit: 4 });

    expect(result.region).toBe("India");
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("serves from cache on subsequent calls within TTL", async () => {
    const firstCall = await getMotorcycleNews({ country: "US", limit: 5 });
    const secondCall = await getMotorcycleNews({ country: "US", limit: 5 });

    expect(secondCall.updatedAt).toBe(firstCall.updatedAt);
    expect(secondCall.items.length).toBe(firstCall.items.length);
  });
});
