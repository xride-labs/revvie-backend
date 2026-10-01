import { Router, Request, Response } from "express";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../config/auth.js";
import { asyncHandler } from "../../middlewares/validation.js";
import {
  createCustomerPortalSession,
  createDodoCheckoutSession,
  getDodoConfigStatus,
  verifyDodoWebhook,
  type DodoWebhookEvent,
} from "../../lib/dodoPayments.js";
import {
  getCurrentBillingSubscription,
  refreshUserSubscriptionTier,
  upsertBillingSubscription,
} from "../../lib/subscription.js";

const router = Router();

function toDate(value: unknown): Date | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function syncSubscriptionFromEvent(event: DodoWebhookEvent) {
  const data = event.data;
  const metadata = data?.metadata || {};
  const userId = metadata.userId || metadata.user_id;
  const businessId = metadata.businessId || metadata.business_id;
  const subscriptionType = metadata.type || metadata.subscriptionType;
  const providerSubscriptionId = data?.subscription_id;
  const status = data?.status?.toLowerCase() || null;

  // ── Brand portal subscription ──────────────────────────
  if (subscriptionType === "BRAND_PRO" && businessId) {
    const isActive =
      event.type === "subscription.active" ||
      event.type === "subscription.renewed" ||
      event.type === "subscription.created";

    const brandTier = isActive ? "PRO" : "FREE";
    const brandProExpiresAt = isActive
      ? toDate(data?.next_billing_date) ?? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
      : null;

    await prisma.businessProfile.update({
      where: { id: businessId },
      data: { brandTier, brandProExpiresAt },
    });
    return;
  }

  // ── Rider PRO subscription (original flow) ──────────────
  if (!userId) return;

  if (!providerSubscriptionId || !status) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionTier:
          event.type === "subscription.active" ||
          event.type === "subscription.renewed" ||
          event.type === "subscription.created"
            ? "PRO"
            : "FREE",
      },
    });
    return;
  }

  await upsertBillingSubscription({
    userId,
    provider: "DODO",
    providerCustomerId: data?.customer?.customer_id || null,
    providerSubscriptionId,
    tier: String(metadata.tier || "PRO").toUpperCase(),
    plan: metadata.plan || metadata.plan_type || null,
    status,
    currentPeriodEnd: toDate(data?.next_billing_date),
    cancelAt: toDate(data?.cancelled_at),
  });

  await refreshUserSubscriptionTier(userId);
}

router.get("/config-status", (_req: Request, res: Response) => {
  ApiResponse.success(res, getDodoConfigStatus(), "Dodo config status loaded");
});

// Get the current user's subscription details
router.get(
  "/subscription",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const subscription = await getCurrentBillingSubscription(userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });

    ApiResponse.success(res, {
      tier: user?.subscriptionTier || "FREE",
      subscription: subscription
        ? {
            id: subscription.id,
            provider: subscription.provider,
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAt: subscription.cancelAt,
            createdAt: subscription.createdAt,
          }
        : null,
    });
  }),
);

// Manual sync — force-refreshes the subscription tier from billing records.
// Call this after a successful payment if the webhook hasn't fired yet.
router.post(
  "/sync",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const tier = await refreshUserSubscriptionTier(userId);
    const subscription = await getCurrentBillingSubscription(userId);

    ApiResponse.success(res, {
      tier,
      synced: true,
      subscription: subscription
        ? {
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
          }
        : null,
    });
  }),
);

// Create a checkout session (e.g. for Pro subscription)
router.post(
  "/checkout-session",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const billingCycle =
      req.body?.billingCycle === "annual" ? "annual" : "monthly";
    const monthlyId = process.env.DODO_PRO_MONTHLY_PRODUCT_ID?.trim();
    const annualId = process.env.DODO_PRO_ANNUAL_PRODUCT_ID?.trim();
    const productId = billingCycle === "annual" ? annualId : monthlyId;

    if (!productId) {
      return ApiResponse.error(
        res,
        `Dodo product ID is not configured for the ${billingCycle} plan. Set DODO_PRO_${billingCycle === "annual" ? "ANNUAL" : "MONTHLY"}_PRODUCT_ID in the backend .env.`,
        500,
        ErrorCode.EXTERNAL_SERVICE_ERROR,
      );
    }

    // Guard against a misconfigured .env where the annual and monthly IDs
    // are the same — this silently downgrades annual subscribers to monthly
    // pricing without surfacing an error. Warn loudly so it's obvious.
    if (monthlyId && annualId && monthlyId === annualId) {
      console.warn(
        "[payments] DODO_PRO_MONTHLY_PRODUCT_ID === DODO_PRO_ANNUAL_PRODUCT_ID — annual and monthly will bill identically",
      );
    }

    // Allow the mobile client to override the return URL so the deep-link
    // scheme matches whatever the client is using. The backend still needs
    // DODO_PAYMENTS_RETURN_URL as a fallback for the web/manage flows.
    const clientReturnUrl =
      typeof req.body?.returnUrl === "string" ? req.body.returnUrl : undefined;
    const clientCancelUrl =
      typeof req.body?.cancelUrl === "string" ? req.body.cancelUrl : undefined;

    const checkout = await createDodoCheckoutSession({
      productId,
      customer: {
        email: session.user.email,
        name: session.user.name,
      },
      returnUrl: clientReturnUrl,
      cancelUrl: clientCancelUrl,
      metadata: {
        userId: session.user.id,
        tier: "PRO",
        plan: billingCycle,
        source: "mobile_pro_upgrade",
      },
    });

    const checkoutUrl = checkout.checkout_url || checkout.url;
    if (!checkoutUrl) {
      return ApiResponse.error(
        res,
        "Dodo did not return a checkout URL. Verify DODO_PAYMENTS_API_KEY and the product IDs.",
        502,
        ErrorCode.EXTERNAL_SERVICE_ERROR,
      );
    }

    ApiResponse.success(
      res,
      {
        checkoutUrl,
        sessionId: checkout.session_id || null,
        billingCycle,
      },
      "Checkout session created successfully",
    );
  }),
);

router.get(
  "/portal",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const subscription = await getCurrentBillingSubscription(session.user.id);

    if (!subscription?.providerCustomerId) {
      return ApiResponse.error(
        res,
        "No Dodo customer is linked to this account yet",
        409,
        ErrorCode.CONFLICT,
      );
    }

    const portal = await createCustomerPortalSession(
      subscription.providerCustomerId,
      false,
    );

    ApiResponse.success(
      res,
      { portalUrl: portal.portal_url || portal.url },
      "Customer portal created successfully",
    );
  }),
);

// ─── Brand PRO subscriptions ────────────────────────────────────────────────

// Brand portal subscription checkout
router.post(
  "/brand-checkout",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { businessId, returnUrl, cancelUrl } = req.body || {};

    if (!businessId) {
      return ApiResponse.error(res, "businessId is required", 400);
    }

    const business = await prisma.businessProfile.findFirst({
      where: { id: businessId, ownerId: session.user.id },
      select: { id: true, displayName: true, brandTier: true },
    });

    if (!business) {
      return ApiResponse.error(res, "Business not found or access denied", 404);
    }

    if (business.brandTier === "PRO") {
      return ApiResponse.error(res, "This business already has a Brand Pro subscription", 409);
    }

    const productId = process.env.DODO_BRAND_MONTHLY_PRODUCT_ID?.trim();
    if (!productId) {
      return ApiResponse.error(
        res,
        "Brand subscription is not configured yet. Set DODO_BRAND_MONTHLY_PRODUCT_ID in the backend .env.",
        500,
      );
    }

    const webUrl = process.env.EXPO_PUBLIC_WEB_URL || process.env.WEB_URL || "https://revvie.app";
    const checkout = await createDodoCheckoutSession({
      productId,
      customer: { email: session.user.email, name: session.user.name },
      returnUrl: returnUrl || `${webUrl}/brand/billing?status=success`,
      cancelUrl: cancelUrl || `${webUrl}/brand/billing?status=cancelled`,
      metadata: {
        type: "BRAND_PRO",
        businessId: business.id,
        userId: session.user.id,
        plan: "monthly",
      },
    });

    const checkoutUrl = checkout.checkout_url || checkout.url;
    if (!checkoutUrl) {
      return ApiResponse.error(res, "Dodo did not return a checkout URL", 502);
    }

    ApiResponse.success(res, { checkoutUrl }, "Brand checkout session created");
  }),
);

// Get brand subscription status
router.get(
  "/brand-status/:businessId",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { businessId } = req.params;

    const business = await prisma.businessProfile.findFirst({
      where: { id: businessId, ownerId: session.user.id },
      select: { id: true, brandTier: true, brandProExpiresAt: true },
    });

    if (!business) {
      return ApiResponse.error(res, "Business not found or access denied", 404);
    }

    // Auto-downgrade if the subscription has expired
    const now = new Date();
    if (
      business.brandTier === "PRO" &&
      business.brandProExpiresAt &&
      business.brandProExpiresAt < now
    ) {
      await prisma.businessProfile.update({
        where: { id: businessId },
        data: { brandTier: "FREE", brandProExpiresAt: null },
      });
      return ApiResponse.success(res, { tier: "FREE", expiresAt: null });
    }

    ApiResponse.success(res, {
      tier: business.brandTier,
      expiresAt: business.brandProExpiresAt,
    });
  }),
);

// Dodo Webhook Handler
router.post(
  "/webhook",
  asyncHandler(async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : JSON.stringify(req.body || {});

    const webhookHeaders = {
      "webhook-id": String(req.headers["webhook-id"] || ""),
      "webhook-signature": String(req.headers["webhook-signature"] || ""),
      "webhook-timestamp": String(req.headers["webhook-timestamp"] || ""),
    };

    const payload = verifyDodoWebhook(rawBody, webhookHeaders);

    if (
      payload.type === "subscription.active" ||
      payload.type === "subscription.created" ||
      payload.type === "subscription.renewed" ||
      payload.type === "subscription.cancelled" ||
      payload.type === "subscription.canceled" ||
      payload.type === "subscription.failed" ||
      payload.type === "subscription.expired" ||
      payload.type === "subscription.on_hold"
    ) {
      await syncSubscriptionFromEvent(payload);
    }

    ApiResponse.success(res, { received: true }, "Webhook received");
  }),
);

export default router;
