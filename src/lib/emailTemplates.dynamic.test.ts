import { describe, it, expect } from "vitest";
import {
  buildWelcomeTemplate,
  buildOtpTemplate,
  buildVerificationTemplate,
} from "./emailTemplates.js";
import { BrandingConfig } from "../services/branding/branding.types.js";

const customBranding: BrandingConfig = {
  siteName: "Revvie Motorsports",
  siteUrl: "https://motorsports.revvie.app",
  supportEmail: "support@xride-labs.in",
  tagline: "SPEED • PASSION • COMMUNITY",
  logoUrl: "https://cdn.custom.com/brand/logo.png",
  iconUrl: "https://cdn.custom.com/brand/icon.png",
  faviconUrl: "https://cdn.custom.com/brand/favicon.ico",
  primaryColor: "#00E5FF",
  deepColor: "#00838F",
  canvasColor: "#050B14",
  surfaceColor: "#0A192F",
  borderColor: "#1E3A8A",
  fontFamily: "Outfit",
  emailHeaderBadge: "VIP DISPATCH",
};

describe("Dynamic Email Branding Integration", () => {
  it("should dynamically inject custom brand logo, colors, font family, and badge into welcome email", () => {
    const template = buildWelcomeTemplate({
      name: "Krithik",
      appUrl: "https://motorsports.revvie.app",
      branding: customBranding,
    });

    // Check custom logo and tagline
    expect(template.html).toContain("https://cdn.custom.com/brand/icon.png");
    expect(template.html).toContain("SPEED &bull; PASSION &bull; COMMUNITY");
    expect(template.html).toContain("VIP DISPATCH");

    // Check custom colors
    expect(template.html).toContain("#00E5FF");
    expect(template.html).toContain("#050B14");
    expect(template.html).toContain("#0A192F");
    expect(template.html).toContain("#1E3A8A");

    // Check custom typography
    expect(template.html).toContain("Outfit");
  });

  it("should dynamically inject custom branding into OTP emails", () => {
    const template = buildOtpTemplate({
      name: "Krithik",
      otp: "849201",
      branding: customBranding,
    });

    expect(template.html).toContain("849201");
    expect(template.html).toContain("https://cdn.custom.com/brand/icon.png");
    expect(template.html).toContain("#00E5FF");
    expect(template.html).toContain("VIP DISPATCH");
  });

  it("should safely fall back to default design tokens when no branding config is provided", () => {
    const template = buildVerificationTemplate({
      name: "Krithik",
      verifyUrl: "https://revvie.xride-labs.in/verify",
    });

    expect(template.html).toContain("https://res.cloudinary.com/xride-labs/image/upload/revvie/icon_f6occl.png");
    expect(template.html).toContain("#ff1d2d");
    expect(template.html).toContain("#0d0d0f");
    expect(template.html).toContain("Josefin Sans");
    expect(template.html).toContain("OFFICIAL DISPATCH");
  });
});
