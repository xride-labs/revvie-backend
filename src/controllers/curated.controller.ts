import { Request, Response } from "express";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
import {
  getCuratedItineraries,
  getCuratedItineraryById,
  getCuratedPlaces,
  scheduleItineraryAsRide
} from "../services/curated/curated.service.js";

export class CuratedController {
  /**
   * GET /api/curated-itineraries
   * List curated master itineraries with filters
   */
  static async getItineraries(req: Request, res: Response) {
    const filters = req.query as any;
    const result = await getCuratedItineraries(filters);
    return ApiResponse.paginated(
      res,
      result.items,
      result.pagination,
      "Curated itineraries retrieved successfully"
    );
  }

  /**
   * GET /api/curated-itineraries/:id
   * Full itinerary dossier with waypoints
   */
  static async getItineraryById(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const result = await getCuratedItineraryById(id);
      return ApiResponse.success(res, result, "Curated itinerary retrieved successfully");
    } catch (err: any) {
      if (err.statusCode === 404) {
        return ApiResponse.error(res, "Curated itinerary not found", 404, ErrorCode.RESOURCE_NOT_FOUND);
      }
      throw err;
    }
  }

  /**
   * POST /api/curated-itineraries/:id/schedule
   * 1-Tap converts curated template into an active user Ride
   */
  static async scheduleItinerary(req: Request, res: Response) {
    const userId = (req as any).user?.id || (req as any).session?.user?.id;
    if (!userId) {
      return ApiResponse.unauthorized(res, "Authentication required to schedule a ride");
    }

    const { id } = req.params;
    const options = req.body;

    try {
      const ride = await scheduleItineraryAsRide(userId, id, options);
      return ApiResponse.created(res, ride, "Ride scheduled successfully from curated itinerary");
    } catch (err: any) {
      if (err.statusCode === 404) {
        return ApiResponse.error(res, "Curated itinerary not found", 404, ErrorCode.RESOURCE_NOT_FOUND);
      }
      if (err.statusCode === 400) {
        return ApiResponse.badRequest(res, err.message);
      }
      throw err;
    }
  }

  /**
   * GET /api/places/curated
   * List ranked curated places
   */
  static async getPlaces(req: Request, res: Response) {
    const filters = req.query as any;
    const result = await getCuratedPlaces(filters);
    return ApiResponse.paginated(
      res,
      result.items,
      result.pagination,
      "Curated places retrieved successfully"
    );
  }
}
