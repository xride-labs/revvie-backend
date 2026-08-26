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
};

const BRAND = {
  // Page
  pageBg: "#0F0F0F",
  // Header & Footer
  headerBg: "#141414",
  headerBorder: "#2A2A2A",
  footerBg: "#111111",
  // Card
  cardBg: "#1A1A1A",
  softBg: "#222222",
  border: "#2C2C2C",
  // Text
  text: "#F4F4F5",
  textSoft: "#D4D4D8",
  muted: "#A1A1AA",
  mutedSoft: "#71717A",
  // Accent
  accent: "#DC2626",
  teal: "#37C8C3",
  // CTA
  ctaBg: "#DC2626",
  ctaText: "#FFFFFF",
};

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO_STACK =
  "'SF Mono', ui-monospace, Menlo, Consolas, 'Roboto Mono', monospace";

function getAssetBaseUrl(): string {
  const raw =
    process.env.PUBLIC_ASSET_URL?.trim() ||
    process.env.BETTER_AUTH_BASE_URL?.trim() ||
    process.env.BACKEND_URL?.trim() ||
    "http://localhost:5000";
  return raw.replace(/\/+$/, "");
}

const ICON_URL = `${getAssetBaseUrl()}/email-assets/revvie-icon.png`;
const CURRENT_YEAR = new Date().getFullYear();

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

function renderSections(sections: TemplateSection[] = []): string {
  if (!sections.length) return "";

  const rows = sections
    .map((section, index) => {
      const topBorder =
        index === 0 ? "" : `border-top:1px solid ${BRAND.border};`;
      return `
      <tr>
        <td style="padding:16px 20px;${topBorder}">
          <div style="font-family:${FONT_STACK};font-size:13px;font-weight:600;color:${BRAND.text};margin-bottom:4px;">${escapeHtml(section.title)}</div>
          <div style="font-family:${FONT_STACK};font-size:14px;line-height:1.5;color:${BRAND.textSoft};">${escapeHtml(section.description)}</div>
        </td>
      </tr>`;
    })
    .join("");

  return `
    <tr>
      <td style="padding:24px 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="border:1px solid ${BRAND.border};border-radius:8px;background:${BRAND.softBg};overflow:hidden;">
          ${rows}
        </table>
      </td>
    </tr>`;
}

function renderCodeBlock(label?: string, value?: string): string {
  if (!label || !value) return "";

  return `
    <tr>
      <td style="padding:16px 0 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="background:${BRAND.softBg};border:1px solid ${BRAND.border};border-radius:8px;">
          <tr>
            <td align="center" style="padding:24px 20px;">
              <div style="font-family:${FONT_STACK};font-size:12px;font-weight:600;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">${escapeHtml(label)}</div>
              <div style="font-family:${MONO_STACK};font-size:36px;font-weight:700;letter-spacing:8px;color:${BRAND.teal};line-height:1;">${escapeHtml(value)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderCta(label?: string, url?: string): string {
  if (!label || !url) return "";

  const safeUrl = escapeHtml(url);

  return `
    <tr>
      <td style="padding:20px 0 32px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation" width="100%">
          <tr>
            <td align="center">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center" style="border-radius:6px;background:${BRAND.ctaBg};">
                    <a href="${safeUrl}" target="_blank" rel="noopener"
                      style="display:inline-block;padding:14px 32px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:${BRAND.ctaText};text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:16px;">
              <div style="font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${BRAND.mutedSoft};">
                Or copy and paste this URL into your browser:<br/>
                <a href="${safeUrl}" target="_blank" rel="noopener" style="color:${BRAND.teal};text-decoration:underline;word-break:break-all;">${safeUrl}</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function buildHtml(params: LayoutParams): string {
  const sections = renderSections(params.sections);
  const codeBlock = renderCodeBlock(params.codeLabel, params.codeValue);
  const cta = renderCta(params.ctaLabel, params.ctaUrl);

  const outro = params.outro
    ? `<tr><td style="padding:0 0 24px 0;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${BRAND.textSoft};">${escapeHtml(params.outro)}</td></tr>`
    : "";

  const legal = params.legal
    ? `<tr><td style="padding:24px 0 0 0;border-top:1px solid ${BRAND.border};font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${BRAND.mutedSoft};">${escapeHtml(params.legal)}</td></tr>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${escapeHtml(params.heading)}</title>
    <style>
      @media only screen and (max-width: 600px) {
        .email-container { width: 100% !important; max-width: 100% !important; }
        .email-body { padding: 24px 16px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.pageBg};font-family:${FONT_STACK};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">

    <!-- Preheader -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.pageBg};">${escapeHtml(params.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.pageBg};padding:40px 16px;">
      <tr>
        <td align="center">
          
          <table class="email-container" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
            
            <!-- Header -->
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.headerBg};border:1px solid ${BRAND.headerBorder};border-radius:10px 10px 0 0;">
                  <tr>
                    <td style="padding:20px 32px;">
                      <table cellpadding="0" cellspacing="0" role="presentation" width="100%">
                        <tr>
                          <td valign="middle">
                            <table cellpadding="0" cellspacing="0" role="presentation">
                              <tr>
                                <td valign="middle" style="padding-right:12px;">
                                  <img src="${ICON_URL}" alt="Revvie" width="32" height="32" style="display:block;width:32px;height:32px;border:0;outline:none;border-radius:8px;" />
                                </td>
                                <td valign="middle">
                                  <div style="font-family:${FONT_STACK};font-size:16px;font-weight:700;color:#FFFFFF;letter-spacing:-0.01em;line-height:1;">REVVIE</div>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0;">
                      <div style="height:2px;background:${BRAND.teal};"></div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.cardBg};border:1px solid ${BRAND.border};border-top:0;border-radius:0 0 10px 10px;">
                  <tr>
                    <td class="email-body" style="padding:40px 32px;">
                      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                        
                        <!-- Headline -->
                        <tr>
                          <td style="padding:0 0 24px 0;">
                            <h1 style="margin:0;font-family:${FONT_STACK};font-size:24px;line-height:1.2;font-weight:700;color:${BRAND.text};letter-spacing:-0.02em;">${escapeHtml(params.heading)}</h1>
                          </td>
                        </tr>

                        <!-- Greeting & Intro -->
                        <tr>
                          <td style="padding:0 0 16px 0;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${BRAND.textSoft};">${escapeHtml(params.greeting)}</td>
                        </tr>
                        <tr>
                          <td style="padding:0 0 24px 0;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${BRAND.textSoft};">${escapeHtml(params.intro)}</td>
                        </tr>

                        <!-- Dynamic Content -->
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

            <!-- Footer -->
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:24px;">
                  <tr>
                    <td align="center" style="font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${BRAND.mutedSoft};">
                      <div style="margin-bottom:8px;">
                        <strong style="color:${BRAND.muted};">Revvie</strong> &middot; by Xride Labs
                      </div>
                      <div style="margin-bottom:8px;">
                        Questions? Contact <a href="mailto:hello@xride-labs.in" style="color:${BRAND.muted};text-decoration:underline;">hello@xride-labs.in</a>
                      </div>
                      <div>&copy; ${CURRENT_YEAR} Xride Labs. All rights reserved.</div>
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
    "Revvie by Xride Labs",
    "Questions? hello@xride-labs.in",
  ]
    .filter((line) => line !== undefined && line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildWelcomeTemplate(params: {
  name?: string | null;
  appUrl: string;
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const sections: TemplateSection[] = [
    {
      title: "Discover rides near you",
      description:
        "Browse group rides and solo routes happening in your area, and join the ones that match your pace.",
    },
    {
      title: "Join clubs and crews",
      description:
        "Connect with riding communities, plan meetups, and keep your group coordinated in one place.",
    },
    {
      title: "Complete your profile",
      description:
        "Add your bike, experience level, and preferences so we can match you with the right rides and riders.",
    },
  ];

  const html = buildHtml({
    preheader: "Your Revvie account is ready. Here's how to get started.",
    heading: "Welcome to Revvie",
    greeting,
    intro:
      "Your rider account is officially active. Revvie is the home for motorcycle riders to discover routes, join clubs, and connect with the community. Here are a few ways to hit the ground running:",
    sections,
    ctaLabel: "Open Revvie",
    ctaUrl: params.appUrl,
    outro:
      "If you have any questions, just reply to this email — we read every message.",
  });

  const text = buildText({
    greeting,
    heading: "Welcome to Revvie",
    intro:
      "Your rider account is officially active. Revvie is the home for motorcycle riders to discover routes, join clubs, and connect with the community. Here are a few ways to hit the ground running:",
    sections,
    ctaLabel: "Open Revvie",
    ctaUrl: params.appUrl,
    outro: "If you have any questions, just reply to this email.",
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
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const html = buildHtml({
    preheader: "Confirm your email address to activate your Revvie account.",
    heading: "Confirm your email address",
    greeting,
    intro:
      "Please verify your email address to activate your account and secure it against unauthorized access. This link is valid for a limited time.",
    ctaLabel: "Verify Email",
    ctaUrl: params.verifyUrl,
    legal:
      "If you did not create a Revvie account, you can safely ignore this email.",
  });

  const text = buildText({
    greeting,
    heading: "Confirm your email address",
    intro:
      "Please verify your email address to activate your account and secure it against unauthorized access. This link is valid for a limited time.",
    ctaLabel: "Verify Email",
    ctaUrl: params.verifyUrl,
    legal:
      "If you did not create a Revvie account, you can safely ignore this email.",
  });

  return {
    subject: "Confirm your email address",
    html,
    text,
    tags: ["verify-email"],
  };
}

export function buildOtpTemplate(params: {
  name?: string | null;
  otp: string;
  expiresInMinutes?: number;
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const ttl = params.expiresInMinutes || 10;

  const html = buildHtml({
    preheader: `Your Revvie verification code is ${params.otp}.`,
    heading: "Your sign-in code",
    greeting,
    intro:
      "Use the verification code below to finish signing in to your Revvie account.",
    codeLabel: "Verification Code",
    codeValue: params.otp,
    legal: `This code expires in ${ttl} minutes. Revvie will never ask you for this code by phone, email, or chat. If you did not request it, you can safely ignore this message.`,
  });

  const text = buildText({
    greeting,
    heading: "Your sign-in code",
    intro:
      "Use the verification code below to finish signing in to your Revvie account.",
    codeLabel: "Verification Code",
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
}): EmailTemplate {
  const ttl = params.expiresInMinutes || 10;

  const sections: TemplateSection[] = [
    {
      title: "Discover rides near you",
      description:
        "Browse group rides happening in your area and join the ones that match your pace.",
    },
    {
      title: "Join clubs & squads",
      description:
        "Build your rider network, plan meetups, and stay coordinated with your crew.",
    },
  ];

  const html = buildHtml({
    preheader: `Welcome to Revvie! Your verification code is ${params.otp}.`,
    heading: "You're almost in",
    greeting: "Welcome aboard,",
    intro:
      "We're pumped to have you. Verify your email with the code below and you're ready to roll.",
    codeLabel: "Your Verification Code",
    codeValue: params.otp,
    sections,
    legal: `This code expires in ${ttl} minutes. If you didn't request this, you can safely ignore it.`,
  });

  const text = buildText({
    greeting: "Welcome aboard,",
    heading: "You're almost in",
    intro:
      "We're pumped to have you. Verify your email with the code below and you're ready to roll.",
    codeLabel: "Your Verification Code",
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
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const html = buildHtml({
    preheader: "Reset your Revvie account password.",
    heading: "Reset your password",
    greeting,
    intro:
      "We received a request to reset the password for your Revvie account. Click the button below to choose a new password. This link will expire soon.",
    ctaLabel: "Reset Password",
    ctaUrl: params.resetUrl,
    legal:
      "If you did not request a password reset, you can safely ignore this email. Your account remains secure.",
  });

  const text = buildText({
    greeting,
    heading: "Reset your password",
    intro:
      "We received a request to reset the password for your Revvie account. Click the link below to choose a new password.",
    ctaLabel: "Reset Password",
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
}): EmailTemplate {
  const sections: TemplateSection[] = [
    { title: "Ride", description: params.rideTitle },
    { title: "Requested by", description: params.requesterName },
  ];

  if (params.message) {
    sections.push({ title: "Message", description: params.message });
  }

  const html = buildHtml({
    preheader: `${params.requesterName} requested to join ${params.rideTitle}.`,
    heading: "New ride request",
    greeting: "Hi there,",
    intro:
      "A rider has requested to join one of your upcoming rides. Review the details below and open the app to approve or decline.",
    sections,
  });

  const text = buildText({
    greeting: "Hi there,",
    heading: "New ride request",
    intro:
      "A rider has requested to join one of your upcoming rides. Open the app to approve or decline.",
    sections,
  });

  return {
    subject: `New join request: ${params.rideTitle}`,
    html,
    text,
    tags: ["ride-join-request"],
  };
}

export function buildClubJoinTemplate(params: {
  clubName: string;
  memberName: string;
  clubsUrl: string;
}): EmailTemplate {
  const sections: TemplateSection[] = [
    { title: "Club", description: params.clubName },
    { title: "New member", description: params.memberName },
  ];

  const html = buildHtml({
    preheader: `${params.memberName} just joined ${params.clubName}.`,
    heading: "Your club is growing",
    greeting: "Hi there,",
    intro:
      "A new rider just joined your club on Revvie. You can manage your members and community directly from your club dashboard.",
    sections,
    ctaLabel: "Open Club Dashboard",
    ctaUrl: params.clubsUrl,
  });

  const text = buildText({
    greeting: "Hi there,",
    heading: "Your club is growing",
    intro:
      "A new rider just joined your club on Revvie. Manage your members from your club dashboard.",
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
}): EmailTemplate {
  const html = buildHtml({
    preheader: params.subject,
    heading: params.subject,
    greeting: "Hi there,",
    intro: params.message,
    legal:
      "This is an automated system notice from Revvie. If you believe you received it in error, please reply and let us know.",
  });

  const text = buildText({
    greeting: "Hi there,",
    heading: params.subject,
    intro: params.message,
    legal: "This is an automated system notice from Revvie.",
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
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Welcome back,";

  const html = buildHtml({
    preheader: "Your magic link to sign in to Revvie.",
    heading: "Sign in to Revvie",
    greeting,
    intro: "Click the button below to instantly sign in to your account. This link is valid for 10 minutes and can only be used once.",
    ctaLabel: "Sign In Instantly",
    ctaUrl: params.magicLinkUrl,
    outro: "If you didn't request this link, you can safely ignore this email.",
  });

  const text = buildText({
    greeting,
    heading: "Sign in to Revvie",
    intro: "Click the link below to instantly sign in to your account. This link is valid for 10 minutes and can only be used once.",
    ctaLabel: "Sign In Instantly",
    ctaUrl: params.magicLinkUrl,
    outro: "If you didn't request this link, you can safely ignore this email.",
  });

  return {
    subject: "Sign in to Revvie",
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
}): EmailTemplate {
  const firstName = getFirstName(params.name);
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Welcome rider,";

  const qrTicketBlocksHtml = params.tickets
    .map((t, idx) => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(t.ticketCode)}&margin=1`;
      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#181818;border:1px solid #2d2d2d;border-radius:14px;margin-bottom:16px;overflow:hidden;">
          <tr>
            <td style="padding:16px;border-bottom:1px solid #262626;">
              <table role="presentation" width="100%">
                <tr>
                  <td>
                    <span style="font-size:11px;font-family:${FONT_STACK};color:${BRAND.teal};font-weight:700;letter-spacing:1px;text-transform:uppercase;">
                      ENTRY PASS #${idx + 1} ${t.tierName ? `&bull; ${escapeHtml(t.tierName)}` : ""}
                    </span>
                  </td>
                  <td align="right">
                    <span style="font-size:12px;font-family:${MONO_STACK};color:${BRAND.muted};">
                      ${escapeHtml(t.ticketCode)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 16px;background:#121212;">
              <img src="${qrUrl}" width="180" height="180" alt="Ticket QR Code" style="display:block;border-radius:10px;border:3px solid #333333;background:#ffffff;padding:6px;" />
              <p style="margin:12px 0 0 0;font-size:12px;font-family:${FONT_STACK};color:${BRAND.muted};">
                Scan this QR code at the event entrance for admission.
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
      description: `<strong>${escapeHtml(params.eventTitle)}</strong><br/>📅 ${escapeHtml(params.eventDate)} at ${escapeHtml(params.eventTime)}<br/>📍 ${escapeHtml(params.venueName || "Venue details in app")}`,
    },
    {
      title: "Order Breakdown",
      description: `Order #${escapeHtml(params.orderNumber)} &bull; ${params.tickets.length} ${params.tickets.length === 1 ? "Ticket" : "Tickets"}<br/>Total Paid: ${params.totalAmount === 0 ? "FREE" : `₹${params.totalAmount}`} &bull; Method: ${escapeHtml(params.paymentMethod)}`,
    },
  ];

  const html = buildHtml({
    preheader: `Your tickets for ${escapeHtml(params.eventTitle)} are confirmed!`,
    heading: "Event Booking Confirmed!",
    greeting,
    intro: `You're all set! Your tickets for <strong>${escapeHtml(params.eventTitle)}</strong> have been issued. Keep this email handy or open Revvie on your phone at the entrance.`,
    sections,
    outro: qrTicketBlocksHtml + `<p style="margin:20px 0 0 0;font-size:13px;color:${BRAND.mutedSoft};text-align:center;">Revvie Event Gate Control &bull; Powered by Xride Labs</p>`,
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
