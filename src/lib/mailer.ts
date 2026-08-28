import {
  buildAlertTemplate,
  buildClubJoinTemplate,
  buildOtpTemplate,
  buildWelcomeOtpTemplate,
  buildResetPasswordTemplate,
  buildRideJoinRequestTemplate,
  buildVerificationTemplate,
  buildWelcomeTemplate,
  buildMagicLinkTemplate,
} from "./emailTemplates.js";

export type EmailPayload = {
  to: string;
  toName?: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  tags?: string[];
};

const brevoApiUrl = "https://api.brevo.com/v3/smtp/email";

function getRuntimeEmailConfig() {
  const brevoApiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Revvie";
  const fallbackReplyTo = process.env.BREVO_REPLY_TO?.trim();
  const appUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  return {
    brevoApiKey,
    senderEmail,
    senderName,
    fallbackReplyTo,
    appUrl,
  };
}

let warnedMissingBrevoConfig = false;

function isBrevoConfigured(): boolean {
  const { brevoApiKey, senderEmail } = getRuntimeEmailConfig();
  return Boolean(brevoApiKey && senderEmail);
}

function normalizeName(name?: string | null): string | undefined {
  if (!name) {
    return undefined;
  }

  const trimmed = name.trim();
  return trimmed.length ? trimmed : undefined;
}

export function getEmailConfigStatus() {
  const { brevoApiKey, senderEmail, senderName, fallbackReplyTo } =
    getRuntimeEmailConfig();

  return {
    hasApiKey: Boolean(brevoApiKey),
    hasSenderEmail: Boolean(senderEmail),
    senderEmail,
    senderName,
    replyTo: fallbackReplyTo,
    apiConfigured: isBrevoConfigured(),
  };
}

function logBrevoDeliveryHint(parsedBody: any) {
  const message = String(parsedBody?.message || "").toLowerCase();

  if (message.includes("sender")) {
    console.warn(
      "[Email] Brevo rejected sender identity. Verify BREVO_SENDER_EMAIL in Brevo senders/domains.",
    );
  }

  if (message.includes("invalid api key") || message.includes("unauthorized")) {
    console.warn(
      "[Email] Brevo API key appears invalid or unauthorized. Recheck BREVO_API_KEY.",
    );
  }
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (process.env.NODE_ENV === "development") {
    console.log("\n[DEVELOPMENT] Email Sending is DISABLED");
    console.log("[Email] Would have sent email:", {
      subject: payload.subject,
      to: payload.to,
    });
    return true; // Return true to avoid downstream errors
  }

  const { brevoApiKey, senderEmail, senderName, fallbackReplyTo } =
    getRuntimeEmailConfig();

  if (!isBrevoConfigured() || !senderEmail || !brevoApiKey) {
    if (!warnedMissingBrevoConfig) {
      console.warn(
        "[Email] Skipped sending email: BREVO_API_KEY and BREVO_SENDER_EMAIL must be configured",
      );
      warnedMissingBrevoConfig = true;
    }
    return false;
  }

  console.log("[Email] Sending email", {
    subject: payload.subject,
    to: payload.to,
    senderEmail,
  });
  try {
    const response = await fetch(brevoApiUrl, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": brevoApiKey,
      },
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          name: senderName,
        },
        to: [{ email: payload.to, name: payload.toName }],
        subject: payload.subject,
        htmlContent: payload.html,
        textContent: payload.text,
        tags: payload.tags,
        replyTo: payload.replyTo
          ? { email: payload.replyTo }
          : fallbackReplyTo
            ? { email: fallbackReplyTo }
            : undefined,
      }),
    });

    const rawBody = await response.text();
    let parsedBody: any = null;

    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsedBody = rawBody;
    }

    if (!response.ok) {
      console.error(`[Email] Brevo send failed (${response.status})`, {
        subject: payload.subject,
        to: payload.to,
        senderEmail,
        response: parsedBody,
      });
      logBrevoDeliveryHint(parsedBody);
      return false;
    }

    const messageId = parsedBody?.messageId || parsedBody?.messageIds?.[0];
    console.log("[Email] Email sent", {
      subject: payload.subject,
      to: payload.to,
      messageId,
    });

    return true;
  } catch (error) {
    console.error("[Email] Brevo request failed", {
      subject: payload.subject,
      to: payload.to,
      senderEmail,
      error,
    });
    return false;
  }
}

export async function sendVerificationEmail(params: {
  to: string;
  name?: string | null;
  token?: string;
  verifyUrl?: string;
}): Promise<boolean> {
  const { appUrl } = getRuntimeEmailConfig();

  const encodedEmail = encodeURIComponent(params.to);
  const verifyUrl =
    params.verifyUrl ||
    (params.token
      ? `${appUrl}/verify-email?token=${params.token}&email=${encodedEmail}`
      : `${appUrl}/verify-email?email=${encodedEmail}`);

  const template = buildVerificationTemplate({
    name: params.name,
    verifyUrl,
  });

  return sendEmail({
    to: params.to,
    toName: normalizeName(params.name),
    subject: template.subject,
    text: template.text,
    html: template.html,
    tags: template.tags,
  });
}

export async function sendRideJoinRequestEmail(params: {
  to: string;
  rideTitle: string;
  requesterName: string;
  message?: string;
}): Promise<boolean> {
  const template = buildRideJoinRequestTemplate({
    rideTitle: params.rideTitle,
    requesterName: params.requesterName,
    message: params.message,
  });

  return sendEmail({
    to: params.to,
    subject: template.subject,
    text: template.text,
    html: template.html,
    tags: template.tags,
  });
}

export async function sendClubJoinEmail(params: {
  to: string;
  clubName: string;
  memberName: string;
}): Promise<boolean> {
  const { appUrl } = getRuntimeEmailConfig();

  const template = buildClubJoinTemplate({
    clubName: params.clubName,
    memberName: params.memberName,
    clubsUrl: `${appUrl}/clubs`,
  });

  return sendEmail({
    to: params.to,
    subject: template.subject,
    text: template.text,
    html: template.html,
    tags: template.tags,
  });
}

export async function sendAlertEmail(params: {
  to: string;
  subject: string;
  message: string;
}): Promise<boolean> {
  const template = buildAlertTemplate({
    subject: params.subject,
    message: params.message,
  });

  return sendEmail({
    to: params.to,
    subject: template.subject,
    text: template.text,
    html: template.html,
    tags: template.tags,
  });
}

export async function sendResetPasswordEmail(params: {
  to: string;
  name?: string | null;
  resetUrl: string;
}): Promise<boolean> {
  if (process.env.NODE_ENV === "development") {
    console.log(`\n==================================`);
    console.log(`[DEV] Password Reset Link for ${params.to} → ${params.resetUrl}`);
    console.log(`==================================\n`);
  }

  const template = buildResetPasswordTemplate({
    name: params.name,
    resetUrl: params.resetUrl,
  });

  return sendEmail({
    to: params.to,
    toName: normalizeName(params.name),
    subject: template.subject,
    text: template.text,
    html: template.html,
    tags: template.tags,
  });
}

export async function sendOtpEmail(params: {
  to: string;
  otp: string;
  name?: string | null;
  isNewUser?: boolean;
}): Promise<boolean> {
  const template = params.isNewUser
    ? buildWelcomeOtpTemplate({ otp: params.otp })
    : buildOtpTemplate({ name: params.name, otp: params.otp });

  return sendEmail({
    to: params.to,
    toName: normalizeName(params.name),
    subject: template.subject,
    text: template.text,
    html: template.html,
    tags: template.tags,
  });
}

export async function sendWelcomeEmail(params: {
  to: string;
  name?: string | null;
}): Promise<boolean> {
  const { appUrl } = getRuntimeEmailConfig();

  const template = buildWelcomeTemplate({
    name: params.name,
    appUrl,
  });

  return sendEmail({
    to: params.to,
    toName: normalizeName(params.name),
    subject: template.subject,
    text: template.text,
    html: template.html,
    tags: template.tags,
  });
}

export async function sendMagicLinkEmail(params: {
  to: string;
  name?: string | null;
  magicLinkUrl: string;
}): Promise<boolean> {
  const template = buildMagicLinkTemplate({
    name: params.name,
    magicLinkUrl: params.magicLinkUrl,
  });

  return sendEmail({
    to: params.to,
    toName: normalizeName(params.name),
    subject: template.subject,
    text: template.text,
    html: template.html,
    tags: template.tags,
  });
}
