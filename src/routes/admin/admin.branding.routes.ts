import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../config/auth.js";
import { requireAdmin } from "../../middlewares/rbac.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { asyncHandler, validateBody } from "../../middlewares/validation.js";
import {
  getBrandingConfig,
  updateBrandingConfig,
  uploadBrandAsset,
} from "../../services/branding/branding.service.js";
import { updateBrandingSchema } from "../../services/branding/branding.types.js";
import { sendEmail } from "../../lib/mailer.js";
import { buildWelcomeTemplate } from "../../lib/emailTemplates.js";

const router = Router();

// Protect all admin branding routes with authentication & admin role
router.use(requireAuth);
router.use(requireAdmin);

/**
 * GET /api/admin/branding
 * Retrieve current branding configuration
 */
router.get(
  "/branding",
  asyncHandler(async (req: Request, res: Response) => {
    const config = await getBrandingConfig();
    return ApiResponse.success(res, config, "Branding configuration retrieved");
  })
);

/**
 * PUT /api/admin/branding
 * Update branding configuration
 */
router.put(
  "/branding",
  validateBody(updateBrandingSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const updated = await updateBrandingConfig(req.body);
    return ApiResponse.success(
      res,
      updated,
      "Branding configuration updated successfully"
    );
  })
);

const uploadAssetSchema = z.object({
  file: z.string().min(1, "File payload is required"),
  type: z.enum(["logo", "icon", "favicon"]).default("logo"),
});

/**
 * POST /api/admin/branding/upload
 * Upload logo, icon, or favicon directly to Cloudinary under revvie/branding/
 */
router.post(
  "/branding/upload",
  validateBody(uploadAssetSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { file, type } = req.body;

    try {
      const uploaded = await uploadBrandAsset(file, type);
      return ApiResponse.success(
        res,
        uploaded,
        "Brand asset uploaded successfully to Cloudinary"
      );
    } catch (error: any) {
      console.error("[BrandingUpload] Failed to upload asset to Cloudinary:", error);
      return ApiResponse.error(
        res,
        error.message || "Failed to upload asset to Cloudinary",
        500,
        ErrorCode.EXTERNAL_SERVICE_ERROR
      );
    }
  })
);

const testEmailSchema = z.object({
  to: z.string().email().optional(),
});

/**
 * POST /api/admin/branding/test-email
 * Dispatch a test email with current active branding
 */
router.post(
  "/branding/test-email",
  validateBody(testEmailSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const recipient =
      req.body.to ||
      (req as any).session?.user?.email ||
      process.env.BREVO_REPLY_TO ||
      "creativekrithik@gmail.com";

    const branding = await getBrandingConfig();

    const template = buildWelcomeTemplate({
      name: (req as any).session?.user?.name || "Admin Tester",
      appUrl: branding.siteUrl,
    });

    const sent = await sendEmail({
      to: recipient,
      subject: `[Brand Test] ${template.subject}`,
      html: template.html,
      text: template.text,
      tags: ["brand-test"],
    });

    if (!sent) {
      return ApiResponse.error(
        res,
        "Failed to dispatch test email via Brevo. Check Brevo logs.",
        500,
        ErrorCode.EXTERNAL_SERVICE_ERROR
      );
    }

    return ApiResponse.success(
      res,
      { recipient, sentAt: new Date().toISOString() },
      `Test email successfully dispatched to ${recipient}`
    );
  })
);

export default router;
