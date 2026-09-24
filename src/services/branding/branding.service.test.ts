import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBrandingConfig, updateBrandingConfig, clearBrandingCache } from "./branding.service.js";

describe("BrandingService", () => {
  beforeEach(() => {
    clearBrandingCache();
  });

  it("should return valid default branding config when queried", async () => {
    const config = await getBrandingConfig();

    expect(config).toBeDefined();
    expect(config.siteName).toBe("Revvie");
    expect(config.primaryColor).toMatch(/^#[A-Fa-f0-9]{6}$/);
    expect(config.logoUrl).toContain("https://");
    expect(config.iconUrl).toContain("https://");
    expect(config.tagline).toBeDefined();
    expect(config.fontFamily).toBe("Josefin Sans");
  });

  it("should cache branding config and avoid repeated database lookups within TTL", async () => {
    const config1 = await getBrandingConfig();
    const config2 = await getBrandingConfig();

    expect(config1).toEqual(config2);
  });

  it("should invalidate cache and return updated tokens when updateBrandingConfig is called", async () => {
    const initial = await getBrandingConfig();

    const updated = await updateBrandingConfig({
      tagline: "UPDATED TEST TAGLINE",
    });

    expect(updated.tagline).toBe("UPDATED TEST TAGLINE");

    const fresh = await getBrandingConfig();
    expect(fresh.tagline).toBe("UPDATED TEST TAGLINE");

    // Restore tagline
    await updateBrandingConfig({
      tagline: initial.tagline,
    });
  });

  it("should reject invalid hex colors with a validation error", async () => {
    await expect(
      updateBrandingConfig({
        primaryColor: "not-a-color",
      })
    ).rejects.toThrow();
  });
});
