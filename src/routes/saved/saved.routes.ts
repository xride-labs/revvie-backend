import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../config/auth.js";
import { SavedController } from "../../controllers/saved.controller.js";
import { asyncHandler, validateBody } from "../../middlewares/validation.js";

const router = Router();
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────
// Saved Locations (Destinations, Viewpoints, Meetup Spots)
// ─────────────────────────────────────────────────────────────

const savedLocationTypeEnum = z.enum([
  "HOME",
  "WORK",
  "VIEWPOINT",
  "MEETUP",
  "GAS_STATION",
  "FAVORITE",
  "OTHER",
]);

const createSavedLocationSchema = z.object({
  name: z.string().min(1, "Location name is required").max(100),
  address: z.string().min(1, "Address is required"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  type: savedLocationTypeEnum.optional().default("FAVORITE"),
  icon: z.string().max(50).optional().nullable(),
});

const updateSavedLocationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  address: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  type: savedLocationTypeEnum.optional(),
  icon: z.string().max(50).optional().nullable(),
});

/**
 * GET /api/saved/locations
 * List saved destinations for current user
 */
router.get(
  "/locations",
  asyncHandler(SavedController.getLocations)
);

/**
 * POST /api/saved/locations
 * Create a new saved destination
 */
router.post(
  "/locations",
  validateBody(createSavedLocationSchema),
  asyncHandler(SavedController.postLocations)
);

/**
 * PATCH /api/saved/locations/:id
 * Update a saved destination
 */
router.patch(
  "/locations/:id",
  validateBody(updateSavedLocationSchema),
  asyncHandler(SavedController.patchLocationsById)
);

/**
 * DELETE /api/saved/locations/:id
 * Delete a saved destination
 */
router.delete(
  "/locations/:id",
  asyncHandler(SavedController.deleteLocationsById)
);

// ─────────────────────────────────────────────────────────────
// Saved Routes (Bookmarks, Favorite Community Routes)
// ─────────────────────────────────────────────────────────────

const createSavedRouteSchema = z.object({
  rideId: z.string().optional().nullable(),
  title: z.string().max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  startLocation: z.string().optional(),
  startLat: z.number().min(-90).max(90).optional(),
  startLng: z.number().min(-180).max(180).optional(),
  endLocation: z.string().optional().nullable(),
  endLat: z.number().min(-90).max(90).optional().nullable(),
  endLng: z.number().min(-180).max(180).optional().nullable(),
  waypoints: z
    .array(
      z.object({
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
      }),
    )
    .optional()
    .nullable(),
  routeData: z.string().optional().nullable(),
  distance: z.number().optional().nullable(),
  duration: z.number().optional().nullable(),
});

/**
 * GET /api/saved/routes
 * List saved routes for current user with pagination and optional search
 */
router.get(
  "/routes",
  asyncHandler(SavedController.getRoutes)
);

/**
 * POST /api/saved/routes
 * Save a route either from an existing ride or manually
 */
router.post(
  "/routes",
  validateBody(createSavedRouteSchema),
  asyncHandler(SavedController.postRoutes)
);

/**
 * DELETE /api/saved/routes/:id
 * Remove a route from saved routes
 */
router.delete(
  "/routes/:id",
  asyncHandler(SavedController.deleteRoutesById)
);

/**
 * POST /api/saved/routes/toggle-ride/:id
 * 1-tap bookmark toggle for a ride
 */
router.post(
  "/routes/toggle-ride/:id",
  asyncHandler(SavedController.postRoutesToggleRideById)
);

export default router;
