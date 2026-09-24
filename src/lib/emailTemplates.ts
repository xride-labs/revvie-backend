import { BrandingConfig } from "../services/branding/branding.types.js";

export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
  tags: string[];
};

type TemplateSection = {
  title: string;
  description: string;
};

type LayoutParams = {
  preheader: string;
  heading: string;
  greeting: string;
  intro: string;
  sections?: TemplateSection[];
  codeLabel?: string;
  codeValue?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  outro?: string;
  legal?: string;
  headerBadge?: string;
  branding?: BrandingConfig;
};

/**
 * Revvie Brand Design System Tokens (from DESIGN.md)
 * Creative North Star: "One Red Light in a Black Garage"
 * - OLED-Adjacent Black canvas (#0d0d0f)
 * - Elevated Black surface (#1c1c1e)
 * - Steel border (#3a3a3c)
 * - Exactly one saturated accent: Signal Red (#ff1d2d) & Deep Red (#b3151f)
 * - No teal, violet, green, or yellow hues.
 */
const BRAND = {
  // Canvas / Outer page
  canvas: "#0d0d0f",
  // Surface / Main card
  surface: "#1c1c1e",
  surfaceElevated: "#242426",
  surfaceRecessed: "#141416",
  // Borders
  border: "#3a3a3c",
  borderSubtle: "rgba(255, 255, 255, 0.08)",
  // Accent (The One Red Rule)
  red: "#ff1d2d",
  redDeep: "#b3151f",
  redBright: "#ff4d57",
  redGlow: "rgba(255, 29, 45, 0.16)",
  // Typography neutrals
  textPrimary: "#ffffff",
  textSecondary: "#aaaaaa",
  textMuted: "#8e8e93",
  textDark: "#52525b",
  // Primary CTA Button
  ctaBg: "#ff1d2d",
  ctaText: "#ffffff",
  ctaShadow: "#b3151f",
};

const FONT_STACK =
  "'Josefin Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO_STACK =
  "'SF Mono', ui-monospace, Menlo, Monaco, Consolas, 'Roboto Mono', monospace";

export const CLOUDINARY_REVVIE_ICON_URL =
  "https://res.cloudinary.com/xride-labs/image/upload/revvie/icon_f6occl.png";

// Canonical public logo mark hosted on Cloudinary CDN
const ICON_URL =
  process.env.PUBLIC_ASSET_URL?.trim() ||
  process.env.REVVIE_ICON_URL?.trim() ||
  CLOUDINARY_REVVIE_ICON_URL;
const CURRENT_YEAR = new Date().getFullYear();

export interface ResolvedBrandTokens {
  canvas: string;
  surface: string;
  surfaceElevated: string;
  surfaceRecessed: string;
  border: string;
  borderSubtle: string;
  red: string;
  redDeep: string;
  redBright: string;
  redGlow: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDark: string;
  ctaBg: string;
  ctaText: string;
  ctaShadow: string;
  fontFamily: string;
  fontStack: string;
  logoUrl: string;
  siteName: string;
  tagline: string;
  badgeText: string;
  siteUrl: string;
  supportEmail: string;
}

export function resolveBrandTokens(
  branding?: BrandingConfig,
  overrideBadge?: string
): ResolvedBrandTokens {
  const canvas = branding?.canvasColor || BRAND.canvas;
  const surface = branding?.surfaceColor || BRAND.surface;
  const border = branding?.borderColor || BRAND.border;
  const red = branding?.primaryColor || BRAND.red;
  const redDeep = branding?.deepColor || BRAND.redDeep;
  const redBright = branding?.primaryColor || BRAND.redBright;
  const fontFamilyName = branding?.fontFamily || "Josefin Sans";
  const fontStack = `'${fontFamilyName}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
  const logoUrl = branding?.iconUrl || branding?.logoUrl || ICON_URL;
  const siteName = branding?.siteName || "REVVIE";
  const tagline = branding?.tagline
    ? escapeHtml(branding.tagline).replace(/•/g, "&bull;")
    : "RIDE &bull; TRACK &bull; CONNECT";
  const badgeText = branding?.emailHeaderBadge || overrideBadge || "OFFICIAL DISPATCH";
  const siteUrl = branding?.siteUrl || "https://revvie.xride-labs.in";
  const supportEmail = branding?.supportEmail || "hello@xride-labs.in";

  return {
    ...BRAND,
    canvas,
    surface,
    border,
    red,
    redDeep,
    redBright,
    ctaBg: red,
    ctaShadow: redDeep,
    fontFamily: fontFamilyName,
    fontStack,
    logoUrl,
    siteName,
    tagline,
    badgeText,
    siteUrl,
    supportEmail,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeName(name?: string | null): string | undefined {
  if (!name) return undefined;
  const trimmed = name.trim();
  return trimmed.length ? trimmed : undefined;
}

export function getFirstName(name?: string | null): string | undefined {
  const normalized = normalizeName(name);
  if (!normalized) return undefined;
  return normalized.split(/\s+/)[0];
}

/**
 * Renders Spec-Rail inspired structured capability / feature rows
 */
function renderSections(
  sections: TemplateSection[] = [],
  tokens: ResolvedBrandTokens = resolveBrandTokens()
): string {
  if (!sections.length) return "";

  const rows = sections
    .map((section, index) => {
      const topBorder =
        index === 0
          ? ""
          : `border-top:1px solid ${tokens.borderSubtle};`;
      return `
      <tr>
        <td style="padding:16px 20px;${topBorder}">
          <table cellpadding="0" cellspacing="0" role="presentation" width="100%">
            <tr>
              <td valign="top" style="width:20px;padding-top:4px;">
                <div style="width:8px;height:8px;border-radius:50%;background-color:${tokens.red};box-shadow:0 0 0 3px ${tokens.redGlow};"></div>
              </td>
              <td valign="top" style="padding-left:10px;">
                <div style="font-family:${tokens.fontStack};font-size:14px;font-weight:700;color:${tokens.textPrimary};letter-spacing:0.02em;margin-bottom:4px;">
                  ${escapeHtml(section.title)}
                </div>
                <div style="font-family:${tokens.fontStack};font-size:13px;line-height:1.55;color:${tokens.textSecondary};">
                  ${escapeHtml(section.description)}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
    })
    .join("");

  return `
    <tr>
      <td style="padding:12px 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="border:1px solid ${tokens.border};border-radius:14px;background-color:${tokens.surfaceRecessed};overflow:hidden;">
          ${rows}
        </table>
      </td>
    </tr>`;
}

/**
 * Renders the High-Contrast Motorsport OTP / Code Block
 */
function renderCodeBlock(
  label?: string,
  value?: string,
  tokens: ResolvedBrandTokens = resolveBrandTokens()
): string {
  if (!label || !value) return "";

  return `
    <tr>
      <td style="padding:16px 0 28px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="background-color:${tokens.surfaceRecessed};border:2px solid ${tokens.border};border-radius:16px;box-shadow:inset 0 2px 4px rgba(0,0,0,0.5);">
          <tr>
            <td align="center" style="padding:28px 20px;">
              <div style="font-family:${tokens.fontStack};font-size:11px;font-weight:700;color:${tokens.textMuted};text-transform:uppercase;letter-spacing:0.18em;margin-bottom:12px;">
                ${escapeHtml(label)}
              </div>
              <div style="font-family:${MONO_STACK};font-size:38px;font-weight:700;letter-spacing:10px;color:${tokens.textPrimary};line-height:1;margin-bottom:10px;">
                ${escapeHtml(value)}
              </div>
              <div style="font-family:${tokens.fontStack};font-size:11px;font-weight:600;color:${tokens.textMuted};letter-spacing:0.06em;">
                SINGLE-USE AUTHORIZATION &bull; EXPIRES IN 10 MINUTES
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

/**
 * Renders Revvie's signature pill CTA with hard offset sticker shadow
 */
function renderCta(
  label?: string,
  url?: string,
  tokens: ResolvedBrandTokens = resolveBrandTokens()
): string {
  if (!label || !url) return "";

  const safeUrl = escapeHtml(url);

  return `
    <tr>
      <td style="padding:16px 0 32px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation" width="100%">
          <tr>
            <td align="center">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center" style="border-radius:9999px;background-color:${tokens.ctaBg};border:2px solid ${tokens.red};box-shadow:4px 4px 0px ${tokens.ctaShadow};">
                    <a href="${safeUrl}" target="_blank" rel="noopener"
                      style="display:inline-block;padding:16px 40px;font-family:${tokens.fontStack};font-size:14px;font-weight:700;color:${tokens.ctaText};text-decoration:none;letter-spacing:0.14em;text-transform:uppercase;border-radius:9999px;">
                      ${escapeHtml(label)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:18px;">
              <div style="font-family:${tokens.fontStack};font-size:12px;line-height:1.5;color:${tokens.textMuted};">
                Or copy and paste this URL into your browser:<br/>
                <a href="${safeUrl}" target="_blank" rel="noopener" style="color:${tokens.redBright};text-decoration:underline;word-break:break-all;">${safeUrl}</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function buildHtml(params: LayoutParams): string {
  const tokens = resolveBrandTokens(params.branding, params.headerBadge);
  const sections = renderSections(params.sections, tokens);
  const codeBlock = renderCodeBlock(params.codeLabel, params.codeValue, tokens);
  const cta = renderCta(params.ctaLabel, params.ctaUrl, tokens);

  const outro = params.outro
    ? `<tr><td style="padding:0 0 20px 0;font-family:${tokens.fontStack};font-size:15px;line-height:1.6;color:${tokens.textSecondary};">${params.outro}</td></tr>`
    : "";

  const legal = params.legal
    ? `<tr><td style="padding:20px 0 0 0;border-top:1px solid ${tokens.borderSubtle};font-family:${tokens.fontStack};font-size:12px;line-height:1.5;color:${tokens.textMuted};">${escapeHtml(params.legal)}</td></tr>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${escapeHtml(params.heading)}</title>
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(tokens.fontFamily)}:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(tokens.fontFamily)}:wght@400;600;700&display=swap');
      @media only screen and (max-width: 600px) {
        .email-container { width: 100% !important; max-width: 100% !important; }
        .email-body { padding: 28px 18px !important; }
        .email-header { padding: 18px 18px !important; }
        .email-badge { display: none !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${tokens.canvas};font-family:${tokens.fontStack};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">

    <!-- Preheader preview text for inbox -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${tokens.canvas};">${escapeHtml(params.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${tokens.canvas};padding:40px 16px;">
      <tr>
        <td align="center">
          
          <table class="email-container" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
            
            <!-- Top Header Card -->
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${tokens.surface};border:2px solid ${tokens.border};border-bottom:1px solid ${tokens.border};border-radius:20px 20px 0 0;">
                  <tr>
                    <td class="email-header" style="padding:22px 32px;">
                      <table cellpadding="0" cellspacing="0" role="presentation" width="100%">
                        <tr>
                          <td valign="middle">
                            <table cellpadding="0" cellspacing="0" role="presentation">
                              <tr>
                                <td valign="middle" style="padding-right:14px;">
                                  <a href="${tokens.siteUrl}" target="_blank" rel="noopener" style="text-decoration:none;">
                                    <img src="${tokens.logoUrl}" alt="${escapeHtml(tokens.siteName)}" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:10px;border:1px solid ${tokens.border};background-color:${tokens.canvas};object-fit:cover;" />
                                  </a>
                                </td>
                                <td valign="middle">
                                  <div style="font-family:${tokens.fontStack};font-size:20px;font-weight:700;color:${tokens.textPrimary};letter-spacing:0.18em;text-transform:uppercase;line-height:1;">
                                    ${escapeHtml(tokens.siteName)}
                                  </div>
                                  <div style="font-family:${tokens.fontStack};font-size:10px;font-weight:600;color:${tokens.textMuted};letter-spacing:0.2em;text-transform:uppercase;margin-top:4px;">
                                    ${tokens.tagline}
                                  </div>
                                </td>
                              </tr>
                            </table>
                          </td>
                          <td valign="middle" align="right" class="email-badge">
                            <span style="display:inline-block;padding:5px 12px;background-color:${tokens.redGlow};border:1px solid rgba(255,29,45,0.3);border-radius:9999px;font-family:${tokens.fontStack};font-size:10px;font-weight:700;letter-spacing:0.16em;color:${tokens.redBright};text-transform:uppercase;">
                              ${escapeHtml(tokens.badgeText)}
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Main Body Card -->
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${tokens.surface};border:2px solid ${tokens.border};border-top:0;border-radius:0 0 20px 20px;">
                  <tr>
                    <td class="email-body" style="padding:36px 32px 32px 32px;">
                      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                        
                        <!-- Headline -->
                        <tr>
                          <td style="padding:0 0 20px 0;">
                            <h1 style="margin:0;font-family:${tokens.fontStack};font-size:26px;line-height:1.2;font-weight:700;color:${tokens.textPrimary};letter-spacing:-0.02em;">
                              ${escapeHtml(params.heading)}
                            </h1>
                          </td>
                        </tr>

                        <!-- Greeting -->
                        <tr>
                          <td style="padding:0 0 8px 0;font-family:${tokens.fontStack};font-size:15px;line-height:1.6;font-weight:600;color:${tokens.textPrimary};">
                            ${escapeHtml(params.greeting)}
                          </td>
                        </tr>

                        <!-- Intro Paragraph -->
                        <tr>
                          <td style="padding:0 0 24px 0;font-family:${tokens.fontStack};font-size:15px;line-height:1.65;color:${tokens.textSecondary};">
                            ${escapeHtml(params.intro)}
                          </td>
                        </tr>

                        <!-- Dynamic Content Slots -->
                        ${codeBlock}
                        ${cta}
                        ${sections}
                        ${outro}
                        ${legal}

                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Dark Garage Footer -->
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:28px;">
                  <tr>
                    <td align="center" style="font-family:${tokens.fontStack};font-size:12px;line-height:1.7;color:${tokens.textMuted};">
                      <div style="font-weight:700;color:${tokens.textPrimary};letter-spacing:0.16em;text-transform:uppercase;margin-bottom:6px;">
                        ${escapeHtml(tokens.siteName)} &bull; ${tokens.tagline}
                      </div>
                      <div style="color:${tokens.textSecondary};margin-bottom:8px;">
                        The social platform built for motorcycle riders.
                      </div>
                      <div style="margin-bottom:8px;">
                        Questions? <a href="mailto:${tokens.supportEmail}" style="color:${tokens.textPrimary};text-decoration:underline;">${tokens.supportEmail}</a> &bull; <a href="${tokens.siteUrl}" style="color:${tokens.redBright};text-decoration:none;font-weight:600;">${tokens.siteUrl.replace(/^https?:\/\//, "")}</a>
                      </div>
                      <div style="font-size:11px;color:${tokens.textDark};">&copy; ${CURRENT_YEAR} ${escapeHtml(tokens.siteName)}. All rights reserved.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>

  </body>
</html>`.trim();
}

function buildText(params: {
  greeting: string;
  heading: string;
  intro: string;
  sections?: TemplateSection[];
  codeLabel?: string;
  codeValue?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  outro?: string;
  legal?: string;
}): string {
  const sectionLines = (params.sections || [])
    .map((section) => `* ${section.title}: ${section.description}`)
    .join("\n");

  const code =
    params.codeLabel && params.codeValue
      ? `${params.codeLabel}:\n${params.codeValue}`
      : "";

  const cta =
    params.ctaLabel && params.ctaUrl
      ? `${params.ctaLabel}:\n${params.ctaUrl}`
      : "";

  return [
    params.heading,
    "=".repeat(params.heading.length),
    "",
    params.greeting,
    "",
    params.intro,
    "",
    code,
    cta,
    "",
    sectionLines,
    "",
    params.outro || "",
    "",
    params.legal || "",
    "",
    "---",
    "REVVIE • RIDE. TRACK. CONNECT.",
    "Built for motorcycle riders by Xride Labs.",
    "Support: hello@xride-labs.in | Web: https://revvie.xride-labs.in",
  ]
    .filter((line) => line !== undefined && line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildWelcomeTemplate(params: {
  name?: string | null;
  appUrl: string;
  branding?: BrandingConfig;
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${firstName},` : "Hi Rider,";

  const sections: TemplateSection[] = [
    {
      title: "Discover rides & routes near you",
      description:
        "Browse community group rides and solo twisty routes happening in your area, and roll out with riders at your pace.",
    },
    {
      title: "Join motorcycle clubs & crews",
      description:
        "Connect with local rider chapters, coordinate weekend meetups, and stay in sync on the road with live tracking.",
    },
    {
      title: "Complete your garage profile",
      description:
        "Add your motorcycle, riding style, and gear so we can match you with the right crew and relevant routes.",
    },
  ];

  const html = buildHtml({
    preheader: "Your Revvie rider account is ready. Welcome to the crew.",
    heading: "Welcome to Revvie 🏍️",
    greeting,
    intro:
      "Your rider account is officially active. Revvie is built from the asphalt up for motorcycle riders to discover epic routes, coordinate group rides, and connect with the community.",
    sections,
    ctaLabel: "Launch Revvie",
    ctaUrl: params.appUrl,
    headerBadge: params.branding?.emailHeaderBadge || "RIDER ONBOARDING",
    branding: params.branding,
    outro:
      "Hit reply to this email anytime if you have feedback or want to request a local club feature — we read every ride note.",
  });

  const text = buildText({
    greeting,
    heading: "Welcome to Revvie",
    intro:
      "Your rider account is officially active. Revvie is built from the asphalt up for motorcycle riders to discover epic routes, coordinate group rides, and connect with the community.",
    sections,
    ctaLabel: "Launch Revvie",
    ctaUrl: params.appUrl,
    outro: "Hit reply to this email anytime if you have questions.",
  });

  return {
    subject: "Welcome to Revvie 🏍️",
    html,
    text,
    tags: ["onboarding", "welcome"],
  };
}

export function buildVerificationTemplate(params: {
  name?: string | null;
  verifyUrl: string;
  branding?: BrandingConfig;
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${firstName},` : "Hi Rider,";

  const html = buildHtml({
    preheader: "Confirm your email address to activate your Revvie account.",
    heading: "Confirm your email address",
    greeting,
    intro:
      "Please verify your email address to activate your Revvie rider account and secure it against unauthorized access. This link expires in 24 hours.",
    ctaLabel: "Verify Rider Email",
    ctaUrl: params.verifyUrl,
    headerBadge: params.branding?.emailHeaderBadge || "OFFICIAL DISPATCH",
    branding: params.branding,
    legal:
      "If you did not register for Revvie, you can safely disregard this email.",
  });

  const text = buildText({
    greeting,
    heading: "Confirm your email address",
    intro:
      "Please verify your email address to activate your Revvie rider account and secure it against unauthorized access. This link expires in 24 hours.",
    ctaLabel: "Verify Rider Email",
    ctaUrl: params.verifyUrl,
    legal:
      "If you did not register for Revvie, you can safely disregard this email.",
  });

  return {
    subject: "Confirm your email address — Revvie",
    html,
    text,
    tags: ["verify-email"],
  };
}

export function buildOtpTemplate(params: {
  name?: string | null;
  otp: string;
  expiresInMinutes?: number;
  branding?: BrandingConfig;
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${firstName},` : "Hi Rider,";
  const ttl = params.expiresInMinutes || 10;

  const html = buildHtml({
    preheader: `Your Revvie verification code is ${params.otp}.`,
    heading: "Sign-in Authorization",
    greeting,
    intro:
      "Enter the 6-digit verification code below to authorize your session and access your Revvie account.",
    codeLabel: "Authorization Code",
    codeValue: params.otp,
    headerBadge: params.branding?.emailHeaderBadge || "SECURITY PASS",
    branding: params.branding,
    legal: `This code expires in ${ttl} minutes. Revvie staff will never ask for this code. If you did not request this, your account may be targeted — ignore this message.`,
  });

  const text = buildText({
    greeting,
    heading: "Sign-in Authorization",
    intro:
      "Enter the 6-digit verification code below to authorize your session and access your Revvie account.",
    codeLabel: "Authorization Code",
    codeValue: params.otp,
    legal: `This code expires in ${ttl} minutes. Never share this code with anyone.`,
  });

  return {
    subject: `${params.otp} — your Revvie code`,
    html,
    text,
    tags: ["otp"],
  };
}

export function buildWelcomeOtpTemplate(params: {
  otp: string;
  expiresInMinutes?: number;
  branding?: BrandingConfig;
}): EmailTemplate {
  const ttl = params.expiresInMinutes || 10;

  const sections: TemplateSection[] = [
    {
      title: "Discover rides & twisties",
      description:
        "Find vetted routes, scenic hill climbs, and weekend group rides near you.",
    },
    {
      title: "Join clubs & squads",
      description:
        "Build your rider network, coordinate meetups, and stay connected with your pack.",
    },
  ];

  const html = buildHtml({
    preheader: `Welcome to Revvie! Your verification code is ${params.otp}.`,
    heading: "You're almost on the road",
    greeting: "Welcome to the crew,",
    intro:
      "We're excited to have you join the community. Verify your email with the one-time code below to complete registration.",
    codeLabel: "Rider Verification Code",
    codeValue: params.otp,
    sections,
    headerBadge: params.branding?.emailHeaderBadge || "RIDER ACTIVATION",
    branding: params.branding,
    legal: `This code expires in ${ttl} minutes. If you did not request this, you can safely ignore it.`,
  });

  const text = buildText({
    greeting: "Welcome to the crew,",
    heading: "You're almost on the road",
    intro:
      "We're excited to have you join the community. Verify your email with the one-time code below to complete registration.",
    codeLabel: "Rider Verification Code",
    codeValue: params.otp,
    sections,
    legal: `This code expires in ${ttl} minutes. Never share it with anyone.`,
  });

  return {
    subject: `${params.otp} — welcome to Revvie 🏍️`,
    html,
    text,
    tags: ["otp", "welcome"],
  };
}

export function buildResetPasswordTemplate(params: {
  name?: string | null;
  resetUrl: string;
  branding?: BrandingConfig;
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${firstName},` : "Hi Rider,";

  const html = buildHtml({
    preheader: "Reset your Revvie account password.",
    heading: "Reset your password",
    greeting,
    intro:
      "We received a request to reset the password for your Revvie account. Click the button below to choose a new password. This link is valid for 1 hour.",
    ctaLabel: "Set New Password",
    ctaUrl: params.resetUrl,
    headerBadge: params.branding?.emailHeaderBadge || "PASSWORD RESET",
    branding: params.branding,
    legal:
      "If you did not request a password reset, you can safely ignore this email. Your current credentials remain secure.",
  });

  const text = buildText({
    greeting,
    heading: "Reset your password",
    intro:
      "We received a request to reset the password for your Revvie account. Click the link below to choose a new password.",
    ctaLabel: "Set New Password",
    ctaUrl: params.resetUrl,
    legal:
      "If you did not request a password reset, you can safely ignore this email.",
  });

  return {
    subject: "Reset your Revvie password",
    html,
    text,
    tags: ["reset-password"],
  };
}

export function buildRideJoinRequestTemplate(params: {
  rideTitle: string;
  requesterName: string;
  message?: string;
  branding?: BrandingConfig;
}): EmailTemplate {
  const sections: TemplateSection[] = [
    { title: "Ride Title", description: params.rideTitle },
    { title: "Rider Name", description: params.requesterName },
  ];

  if (params.message) {
    sections.push({ title: "Note from Rider", description: params.message });
  }

  const html = buildHtml({
    preheader: `${params.requesterName} requested to join ${params.rideTitle}.`,
    heading: "New ride request",
    greeting: "Attention Ride Lead,",
    intro:
      "A rider has submitted a request to join your upcoming pack ride. Review their request below and head into the app to accept or decline.",
    sections,
    headerBadge: params.branding?.emailHeaderBadge || "RIDE DISPATCH",
    branding: params.branding,
  });

  const text = buildText({
    greeting: "Attention Ride Lead,",
    heading: "New ride request",
    intro:
      "A rider has submitted a request to join your upcoming pack ride. Open Revvie to review.",
    sections,
  });

  return {
    subject: `Join Request: ${params.rideTitle}`,
    html,
    text,
    tags: ["ride-join-request"],
  };
}

export function buildClubJoinTemplate(params: {
  clubName: string;
  memberName: string;
  clubsUrl: string;
  branding?: BrandingConfig;
}): EmailTemplate {
  const sections: TemplateSection[] = [
    { title: "Motorcycle Club", description: params.clubName },
    { title: "New Rider", description: params.memberName },
  ];

  const html = buildHtml({
    preheader: `${params.memberName} just joined ${params.clubName}.`,
    heading: "New Member Joined",
    greeting: "Hello Club Admin,",
    intro:
      "A new rider has just joined your club on Revvie. You can manage your member roster, assign squad roles, and schedule rides from your dashboard.",
    sections,
    ctaLabel: "Open Club Dashboard",
    ctaUrl: params.clubsUrl,
    headerBadge: params.branding?.emailHeaderBadge || "CLUB DISPATCH",
    branding: params.branding,
  });

  const text = buildText({
    greeting: "Hello Club Admin,",
    heading: "New Member Joined",
    intro:
      "A new rider has just joined your club on Revvie. Manage your roster from your club dashboard.",
    sections,
    ctaLabel: "Open Club Dashboard",
    ctaUrl: params.clubsUrl,
  });

  return {
    subject: `New member in ${params.clubName}`,
    html,
    text,
    tags: ["club-member"],
  };
}

export function buildAlertTemplate(params: {
  subject: string;
  message: string;
  branding?: BrandingConfig;
}): EmailTemplate {
  const html = buildHtml({
    preheader: params.subject,
    heading: params.subject,
    greeting: "Hi Rider,",
    intro: params.message,
    headerBadge: params.branding?.emailHeaderBadge || "SYSTEM ALERT",
    branding: params.branding,
    legal:
      "This is an automated system dispatch from Revvie. If you received this in error, contact support.",
  });

  const text = buildText({
    greeting: "Hi Rider,",
    heading: params.subject,
    intro: params.message,
    legal: "This is an automated system dispatch from Revvie.",
  });

  return {
    subject: params.subject,
    html,
    text,
    tags: ["alert"],
  };
}

export function buildMagicLinkTemplate(params: {
  name?: string | null;
  magicLinkUrl: string;
  branding?: BrandingConfig;
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Welcome back Rider,";

  const html = buildHtml({
    preheader: "Your magic link to sign in to Revvie.",
    heading: "Sign in to Revvie",
    greeting,
    intro:
      "Click the button below to instantly sign in to your Revvie account. This secure one-click link is valid for 10 minutes and can only be used once.",
    ctaLabel: "Sign In Instantly",
    ctaUrl: params.magicLinkUrl,
    headerBadge: params.branding?.emailHeaderBadge || "INSTANT ACCESS",
    branding: params.branding,
    outro: "If you did not request this sign-in link, you can safely ignore this email.",
  });

  const text = buildText({
    greeting,
    heading: "Sign in to Revvie",
    intro:
      "Click the link below to instantly sign in to your account. This link is valid for 10 minutes and can only be used once.",
    ctaLabel: "Sign In Instantly",
    ctaUrl: params.magicLinkUrl,
    outro: "If you did not request this link, you can safely ignore this email.",
  });

  return {
    subject: "Sign in to Revvie — One-Click Link",
    html,
    text,
    tags: ["magic-link"],
  };
}

export function buildEventBookingConfirmationTemplate(params: {
  name?: string | null;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  venueName?: string | null;
  orderNumber: string;
  totalAmount: number;
  paymentMethod: string;
  tickets: Array<{ ticketCode: string; tierName?: string }>;
  branding?: BrandingConfig;
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Welcome rider,";
  const tokens = resolveBrandTokens(params.branding);

  const qrTicketBlocksHtml = params.tickets
    .map((t, idx) => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(t.ticketCode)}&margin=1`;
      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tokens.surfaceRecessed};border:2px solid ${tokens.border};border-radius:16px;margin-bottom:18px;overflow:hidden;">
          <tr>
            <td style="padding:16px 20px;border-bottom:1px solid ${tokens.borderSubtle};background:${tokens.surfaceElevated};">
              <table role="presentation" width="100%">
                <tr>
                  <td>
                    <span style="font-size:11px;font-family:${tokens.fontStack};color:${tokens.redBright};font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">
                      ENTRY PASS #${idx + 1} ${t.tierName ? `&bull; ${escapeHtml(t.tierName)}` : ""}
                    </span>
                  </td>
                  <td align="right">
                    <span style="font-size:13px;font-family:${MONO_STACK};font-weight:700;color:${tokens.textPrimary};letter-spacing:1px;">
                      ${escapeHtml(t.ticketCode)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 16px;background:${tokens.surfaceRecessed};">
              <img src="${qrUrl}" width="180" height="180" alt="Ticket QR Code" style="display:block;border-radius:12px;border:3px solid ${tokens.border};background:#ffffff;padding:8px;" />
              <p style="margin:14px 0 0 0;font-size:12px;font-family:${tokens.fontStack};font-weight:600;color:${tokens.textMuted};letter-spacing:0.04em;">
                SCAN AT GATE CONTROL FOR ADMISSION
              </p>
            </td>
          </tr>
        </table>
      `;
    })
    .join("");

  const sections: TemplateSection[] = [
    {
      title: "Event Details",
      description: `<strong>${escapeHtml(params.eventTitle)}</strong><br/>📅 ${escapeHtml(params.eventDate)} at ${escapeHtml(params.eventTime)}<br/>📍 ${escapeHtml(params.venueName || "Venue coordinates in Revvie app")}`,
    },
    {
      title: "Order Breakdown",
      description: `Order #${escapeHtml(params.orderNumber)} &bull; ${params.tickets.length} ${params.tickets.length === 1 ? "Pass" : "Passes"}<br/>Total Paid: ${params.totalAmount === 0 ? "FREE" : `₹${params.totalAmount}`} &bull; Method: ${escapeHtml(params.paymentMethod)}`,
    },
  ];

  const html = buildHtml({
    preheader: `Your entry passes for ${escapeHtml(params.eventTitle)} are confirmed!`,
    heading: "Event Booking Confirmed!",
    greeting,
    intro: `You're all set. Your admission passes for <strong>${escapeHtml(params.eventTitle)}</strong> have been issued. Keep this email handy or open your pass in the Revvie app at the gate entrance.`,
    sections,
    headerBadge: params.branding?.emailHeaderBadge || "GATE PASS CONFIRMED",
    branding: params.branding,
    outro: qrTicketBlocksHtml + `<p style="margin:20px 0 0 0;font-size:12px;color:${tokens.textMuted};text-align:center;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(tokens.siteName)} Gate Control &bull; Powered by Xride Labs</p>`,
  });

  const text = buildText({
    greeting,
    heading: "Event Booking Confirmed!",
    intro: `Your tickets for ${params.eventTitle} are confirmed.\nDate: ${params.eventDate} at ${params.eventTime}\nVenue: ${params.venueName || "Check App"}\nOrder #${params.orderNumber}\nTickets:\n` +
      params.tickets.map((t, i) => `Ticket ${i + 1}: ${t.ticketCode} (${t.tierName || "General"})`).join("\n"),
    outro: "Present your ticket code at the entrance for admission.",
  });

  return {
    subject: `Booking Confirmed: ${params.eventTitle} (Order #${params.orderNumber})`,
    html,
    text,
    tags: ["event-booking", "ticket-pass"],
  };
}

export function buildMarketplaceContactTemplate(params: {
  sellerName?: string | null;
  listingTitle: string;
  listingUrl: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone?: string | null;
  message: string;
  branding?: BrandingConfig;
}): EmailTemplate {
  const firstName = getFirstName(params.sellerName);
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi Seller,";

  const sections: TemplateSection[] = [
    { title: "Marketplace Listing", description: params.listingTitle },
    { title: "Interested Rider", description: params.buyerName },
    { title: "Buyer Email", description: params.buyerEmail },
  ];

  if (params.buyerPhone) {
    sections.push({ title: "Buyer Phone", description: params.buyerPhone });
  }

  sections.push({ title: "Inquiry Message", description: params.message });

  const html = buildHtml({
    preheader: `${params.buyerName} is interested in "${params.listingTitle}" on Revvie.`,
    heading: "New Marketplace Inquiry",
    greeting,
    intro:
      "A rider found your listing on the Revvie marketplace and wants to connect. Hit reply to this email to communicate with them directly.",
    sections,
    ctaLabel: "View Listing on Marketplace",
    ctaUrl: params.listingUrl,
    headerBadge: params.branding?.emailHeaderBadge || "MARKETPLACE INQUIRY",
    branding: params.branding,
  });

  const text = buildText({
    greeting,
    heading: "New Marketplace Inquiry",
    intro:
      "A rider found your listing on the Revvie marketplace and wants to connect. Reply to this email to communicate directly.",
    sections,
    ctaLabel: "View Listing on Marketplace",
    ctaUrl: params.listingUrl,
  });

  return {
    subject: `New inquiry about "${params.listingTitle}" — Revvie Marketplace`,
    html,
    text,
    tags: ["marketplace-contact"],
  };
}
