import { Router } from "express";
import { CuratedController } from "../../controllers/curated.controller.js";
import { requireAuth } from "../../config/auth.js";
import { asyncHandler, validateQuery, validateBody } from "../../middlewares/validation.js";
import {
  curatedItinerariesQuerySchema,
  scheduleItinerarySchema,
  curatedPlacesQuerySchema
} from "../../validators/curated.validators.js";

const router = Router();

/**
 * @swagger
 * /api/curated-itineraries:
 *   get:
 *     summary: Get curated motorcycle itineraries
 *     description: Returns curated itineraries filtered by highway corridor, duration tier, theme, or rating.
 *     tags: [Curated]
 */
router.get(
  "/",
  validateQuery(curatedItinerariesQuerySchema),
  asyncHandler(CuratedController.getItineraries)
);

/**
 * @swagger
 * /api/curated-itineraries/places/curated:
 *   get:
 *     summary: Get ranked curated places and POIs
 *     tags: [Curated]
 */
router.get(
  "/places/curated",
  validateQuery(curatedPlacesQuerySchema),
  asyncHandler(CuratedController.getPlaces)
);

/**
 * @swagger
 * /api/curated-itineraries/{id}:
 *   get:
 *     summary: Get full curated itinerary dossier with waypoints
 *     tags: [Curated]
 */
router.get(
  "/:id",
  asyncHandler(CuratedController.getItineraryById)
);

/**
 * @swagger
 * /api/curated-itineraries/{id}/schedule:
 *   post:
 *     summary: 1-Tap schedule a curated itinerary as a user Ride
 *     tags: [Curated]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 */
router.post(
  "/:id/schedule",
  requireAuth,
  validateBody(scheduleItinerarySchema),
  asyncHandler(CuratedController.scheduleItinerary)
);

export default router;
