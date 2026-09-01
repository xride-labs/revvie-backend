import { Router, Request, Response } from "express";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse } from "../../lib/utils/apiResponse.js";
import { validateQuery, asyncHandler } from "../../middlewares/validation.js";
import { discoveryFeedQuerySchema } from "../../validators/schemas.js";
import { z } from "zod";
import { getDiscoveryFeed } from "../../services/feed/feed.service.js";
import { getMotorcycleNews } from "../../services/feed/news.service.js";

const router = Router();

// All discovery routes require authentication
router.use(requireAuth);

/**
 * @swagger
 * /api/discover:
 *   get:
 *     summary: Get location-based discovery feed
 *     description: |
 *       Returns a ranked, location-first discovery feed containing nearby rides,
 *       upcoming rides, popular clubs, new clubs, nearby businesses, and marketplace listings.
 *       All items include their distance from the user in kilometres.
 *     tags: [Discovery]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -90
 *           maximum: 90
 *         description: User latitude
 *       - in: query
 *         name: lng
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -180
 *           maximum: 180
 *         description: User longitude
 *       - in: query
 *         name: radiusKm
 *         schema:
 *           type: number
 *           default: 50
 *           maximum: 500
 *         description: Search radius in kilometres
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for rides pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 50
 *         description: Items per section
 *       - in: query
 *         name: rideType
 *         schema:
 *           type: string
 *           enum: [Beginner, Intermediate, Expert]
 *         description: Filter rides by experience level
 *       - in: query
 *         name: difficulty
 *         schema:
 *           type: string
 *           enum: [Leisurely, Moderate, Fast]
 *         description: Filter rides by pace
 *       - in: query
 *         name: upcomingOnly
 *         schema:
 *           type: boolean
 *         description: Only return rides scheduled in the future
 *     responses:
 *       200:
 *         description: Discovery feed sections
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nearbyRides:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       distanceKm:
 *                         type: number
 *                       score:
 *                         type: number
 *                       data:
 *                         $ref: '#/components/schemas/Ride'
 *                 upcomingRides:
 *                   type: array
 *                 clubsNearYou:
 *                   type: array
 *                 newClubs:
 *                   type: array
 *                 nearbyBusinesses:
 *                   type: array
 *                 nearbyListings:
 *                   type: array
 *       400:
 *         description: Missing or invalid lat/lng
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get(
  "/",
  validateQuery(discoveryFeedQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      lat,
      lng,
      radiusKm,
      page,
      limit,
      rideType,
      difficulty,
      upcomingOnly,
    } = req.query as any;

    const feed = await getDiscoveryFeed({
      lat: Number(lat),
      lng: Number(lng),
      radiusKm: radiusKm ? Number(radiusKm) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      rideType,
      difficulty,
      upcomingOnly: upcomingOnly === "true" || upcomingOnly === true,
    });

    ApiResponse.success(res, feed, "Discovery feed retrieved successfully");
  }),
);

const newsQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  country: z.string().max(3).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional().default(12),
});

/**
 * @swagger
 * /api/discover/news:
 *   get:
 *     summary: Get live daily motorcycle news and stories
 *     tags: [Discovery]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 12
 */
router.get(
  "/news",
  validateQuery(newsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { lat, lng, country, limit } = req.query as any;
    const result = await getMotorcycleNews({
      lat: lat != null ? Number(lat) : undefined,
      lng: lng != null ? Number(lng) : undefined,
      country: country ? String(country) : undefined,
      limit: limit ? Number(limit) : 12,
    });
    ApiResponse.success(res, result, "Motorcycle news retrieved successfully");
  }),
);

export default router;
