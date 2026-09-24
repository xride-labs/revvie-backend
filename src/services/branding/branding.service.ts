import { prisma } from "../../lib/prisma.js";
import { uploadMedia, MediaType, MediaFolder } from "../../lib/cloudinary.js";
import {
  BrandingConfig,
  UpdateBrandingDTO,
  updateBrandingSchema,
} from "./branding.types.js";

// Canonical hardcoded fallback tokens from web/DESIGN.md ("One Red Light in a Black Garage")
export const DEFAULT_BRANDING: BrandingConfig = {
  siteName: "Revvie",
  siteUrl: "https://revvie.xride-labs.in",
  supportEmail: "hello@xride-labs.in",
  tagline: "RIDE • TRACK • CONNECT",

  logoUrl: "https://res.cloudinary.com/xride-labs/image/upload/revvie/icon_f6occl.png",
  iconUrl: "https://res.cloudinary.com/xride-labs/image/upload/revvie/icon_f6occl.png",
  faviconUrl: null,

  primaryColor: "#ff1d2d",
  deepColor: "#b3151f",
  canvasColor: "#0d0d0f",
  surfaceColor: "#1c1c1e",
  borderColor: "#3a3a3c",

  fontFamily: "Josefin Sans",
  emailHeaderBadge: "OFFICIAL DISPATCH",
};

interface CacheEntry {
  data: BrandingConfig;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedBranding: CacheEntry | null = null;

export function clearBrandingCache(): void {
  cachedBranding = null;
}

/**
 * Retrieves the current branding configuration.
 * Uses an in-memory cache with 5-minute TTL to optimize high-frequency email and web calls.
 */
export async function getBrandingConfig(): Promise<BrandingConfig> {
  const now = Date.now();
  if (cachedBranding && cachedBranding.expiresAt > now) {
    return cachedBranding.data;
  }

  try {
    const record = await prisma.adminSettings.findUnique({
      where: { scope: "global" },
    });

    if (!record) {
      // Seed initial global settings if missing
      const created = await prisma.adminSettings.create({
        data: {
          scope: "global",
          siteName: DEFAULT_BRANDING.siteName,
          siteUrl: DEFAULT_BRANDING.siteUrl,
          supportEmail: DEFAULT_BRANDING.supportEmail,
          tagline: DEFAULT_BRANDING.tagline,
          logoUrl: DEFAULT_BRANDING.logoUrl,
          iconUrl: DEFAULT_BRANDING.iconUrl,
          primaryColor: DEFAULT_BRANDING.primaryColor,
          deepColor: DEFAULT_BRANDING.deepColor,
          canvasColor: DEFAULT_BRANDING.canvasColor,
          surfaceColor: DEFAULT_BRANDING.surfaceColor,
          borderColor: DEFAULT_BRANDING.borderColor,
          fontFamily: DEFAULT_BRANDING.fontFamily,
          emailHeaderBadge: DEFAULT_BRANDING.emailHeaderBadge,
        },
      });

      const config: BrandingConfig = {
        siteName: created.siteName,
        siteUrl: created.siteUrl,
        supportEmail: created.supportEmail,
        tagline: created.tagline,
        logoUrl: created.logoUrl,
        iconUrl: created.iconUrl,
        faviconUrl: created.faviconUrl,
        primaryColor: created.primaryColor,
        deepColor: created.deepColor,
        canvasColor: created.canvasColor,
        surfaceColor: created.surfaceColor,
        borderColor: created.borderColor,
        fontFamily: created.fontFamily,
        emailHeaderBadge: created.emailHeaderBadge,
        updatedAt: created.updatedAt,
      };

      cachedBranding = { data: config, expiresAt: now + CACHE_TTL_MS };
      return config;
    }

    const config: BrandingConfig = {
      siteName: record.siteName || DEFAULT_BRANDING.siteName,
      siteUrl: record.siteUrl || DEFAULT_BRANDING.siteUrl,
      supportEmail: record.supportEmail || DEFAULT_BRANDING.supportEmail,
      tagline: record.tagline || DEFAULT_BRANDING.tagline,
      logoUrl: record.logoUrl || DEFAULT_BRANDING.logoUrl,
      iconUrl: record.iconUrl || DEFAULT_BRANDING.iconUrl,
      faviconUrl: record.faviconUrl,
      primaryColor: record.primaryColor || DEFAULT_BRANDING.primaryColor,
      deepColor: record.deepColor || DEFAULT_BRANDING.deepColor,
      canvasColor: record.canvasColor || DEFAULT_BRANDING.canvasColor,
      surfaceColor: record.surfaceColor || DEFAULT_BRANDING.surfaceColor,
      borderColor: record.borderColor || DEFAULT_BRANDING.borderColor,
      fontFamily: record.fontFamily || DEFAULT_BRANDING.fontFamily,
      emailHeaderBadge: record.emailHeaderBadge || DEFAULT_BRANDING.emailHeaderBadge,
      updatedAt: record.updatedAt,
    };

    cachedBranding = { data: config, expiresAt: now + CACHE_TTL_MS };
    return config;
  } catch (error) {
    console.error("[BrandingService] Error fetching branding settings, using fallback defaults:", error);
    return DEFAULT_BRANDING;
  }
}

/**
 * Updates the global branding configuration in PostgreSQL and clears the cache.
 */
export async function updateBrandingConfig(
  input: UpdateBrandingDTO
): Promise<BrandingConfig> {
  const validated = updateBrandingSchema.parse(input);

  const updated = await prisma.adminSettings.upsert({
    where: { scope: "global" },
    update: {
      ...validated,
    },
    create: {
      scope: "global",
      siteName: validated.siteName || DEFAULT_BRANDING.siteName,
      siteUrl: validated.siteUrl || DEFAULT_BRANDING.siteUrl,
      supportEmail: validated.supportEmail || DEFAULT_BRANDING.supportEmail,
      tagline: validated.tagline || DEFAULT_BRANDING.tagline,
      logoUrl: validated.logoUrl || DEFAULT_BRANDING.logoUrl,
      iconUrl: validated.iconUrl || DEFAULT_BRANDING.iconUrl,
      faviconUrl: validated.faviconUrl,
      primaryColor: validated.primaryColor || DEFAULT_BRANDING.primaryColor,
      deepColor: validated.deepColor || DEFAULT_BRANDING.deepColor,
      canvasColor: validated.canvasColor || DEFAULT_BRANDING.canvasColor,
      surfaceColor: validated.surfaceColor || DEFAULT_BRANDING.surfaceColor,
      borderColor: validated.borderColor || DEFAULT_BRANDING.borderColor,
      fontFamily: validated.fontFamily || DEFAULT_BRANDING.fontFamily,
      emailHeaderBadge: validated.emailHeaderBadge || DEFAULT_BRANDING.emailHeaderBadge,
    },
  });

  clearBrandingCache();

  const config: BrandingConfig = {
    siteName: updated.siteName,
    siteUrl: updated.siteUrl,
    supportEmail: updated.supportEmail,
    tagline: updated.tagline,
    logoUrl: updated.logoUrl,
    iconUrl: updated.iconUrl,
    faviconUrl: updated.faviconUrl,
    primaryColor: updated.primaryColor,
    deepColor: updated.deepColor,
    canvasColor: updated.canvasColor,
    surfaceColor: updated.surfaceColor,
    borderColor: updated.borderColor,
    fontFamily: updated.fontFamily,
    emailHeaderBadge: updated.emailHeaderBadge,
    updatedAt: updated.updatedAt,
  };

  cachedBranding = { data: config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

/**
 * Uploads a branding image to Cloudinary in the "revvie/branding" directory.
 */
export async function uploadBrandAsset(
  fileBase64: string,
  assetType: "logo" | "icon" | "favicon"
): Promise<{ url: string; secureUrl: string; publicId: string }> {
  const result = await uploadMedia(fileBase64, {
    folder: MediaFolder.BRANDING,
    publicId: `${assetType}_${Date.now()}`,
    resourceType: MediaType.IMAGE,
  });

  return {
    url: result.url,
    secureUrl: result.secureUrl,
    publicId: result.publicId,
  };
}

export const brandingService = {
  getBrandingConfig,
  updateBrandingConfig,
  uploadBrandAsset,
  clearBrandingCache,
};
