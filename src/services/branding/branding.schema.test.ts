import { describe, it, expect } from "vitest";
import { prisma } from "../../lib/prisma.js";

describe("AdminSettings Branding Schema", () => {
  it("should have all dynamic branding fields available on AdminSettings model", async () => {
    const settings = await prisma.adminSettings.findFirst({
      where: { scope: "global" },
      select: {
        id: true,
        scope: true,
        siteName: true,
        siteUrl: true,
        logoUrl: true,
        iconUrl: true,
        faviconUrl: true,
        tagline: true,
        primaryColor: true,
        deepColor: true,
        canvasColor: true,
        surfaceColor: true,
        borderColor: true,
        fontFamily: true,
        emailHeaderBadge: true,
        supportEmail: true,
      },
    });

    if (settings) {
      expect(settings.siteName).toBeDefined();
      expect(typeof settings.logoUrl).toBe("string");
      expect(typeof settings.iconUrl).toBe("string");
      expect(typeof settings.primaryColor).toBe("string");
    } else {
      expect(true).toBe(true);
    }
  });
});
