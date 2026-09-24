import { Router, Request, Response } from "express";
import { ApiResponse } from "../../lib/utils/apiResponse.js";
import { asyncHandler } from "../../middlewares/validation.js";
import { getBrandingConfig } from "../../services/branding/branding.service.js";

const router = Router();

/**
 * GET /api/public/branding
 * Public endpoint to fetch active branding configuration for web clients.
 * Cached via Cache-Control header (5 minutes).
 */
router.get(
  "/branding",
  asyncHandler(async (req: Request, res: Response) => {
    const branding = await getBrandingConfig();
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, stale-while-revalidate=60"
    );
    return ApiResponse.success(res, branding, "Branding configuration retrieved");
  })
);

export default router;
