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
  listId: z.string().optional().nullable(),
});

const updateSavedLocationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  address: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  type: savedLocationTypeEnum.optional(),
  icon: z.string().max(50).optional().nullable(),
  listId: z.string().optional().nullable(),
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
// Saved Lists / Collections (e.g., "Bangalore 1 day trip")
// ─────────────────────────────────────────────────────────────

const createSavedListSchema = z.object({
  title: z.string().min(1, "List title is required").max(120),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(50).optional().default("map-pin"),
  color: z.string().max(30).optional().default("#8B5CF6"),
  isPublic: z.boolean().optional().default(false),
});

const updateSavedListSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(50).optional(),
  color: z.string().max(30).optional(),
  isPublic: z.boolean().optional(),
});

const importSavedListSchema = z.object({
  title: z.string().min(1, "List title is required").max(120),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(50).optional().default("map-pin"),
  color: z.string().max(30).optional().default("#10B981"),
  isPublic: z.boolean().optional().default(false),
  places: z
    .array(
      z.object({
        name: z.string().min(1, "Place name is required"),
        address: z.string().optional().default(""),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        type: savedLocationTypeEnum.optional().default("VIEWPOINT"),
        icon: z.string().optional().nullable(),
      })
    )
    .min(1, "At least one place is required"),
});

/**
 * GET /api/saved/lists
 * List all saved place lists for current user
 */
router.get("/lists", asyncHandler(SavedController.getLists));

/**
 * POST /api/saved/lists
 * Create a new empty list
 */
router.post(
  "/lists",
  validateBody(createSavedListSchema),
  asyncHandler(SavedController.postLists)
);

/**
 * POST /api/saved/lists/import
 * Atomically create a new list with multiple places
 */
router.post(
  "/lists/import",
  validateBody(importSavedListSchema),
  asyncHandler(SavedController.postImportList)
);

/**
 * GET /api/saved/lists/:id
 * Get a specific list with its saved places
 */
router.get("/lists/:id", asyncHandler(SavedController.getListById));

/**
 * PATCH /api/saved/lists/:id
 * Update list metadata
 */
router.patch(
  "/lists/:id",
  validateBody(updateSavedListSchema),
  asyncHandler(SavedController.patchListById)
);

/**
 * DELETE /api/saved/lists/:id
 * Delete a list and its places
 */
router.delete("/lists/:id", asyncHandler(SavedController.deleteListById));

/**
 * POST /api/saved/lists/:id/places
 * Add a place directly to a list
 */
router.post(
  "/lists/:id/places",
  validateBody(createSavedLocationSchema),
  asyncHandler(SavedController.postPlaceToList)
);

/**
 * DELETE /api/saved/lists/:id/places/:placeId
 * Remove a place from a list
 */
router.delete(
  "/lists/:id/places/:placeId",
  asyncHandler(SavedController.deletePlaceFromList)
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
