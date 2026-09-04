import { Router, Request, Response } from "express";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { validateBody, asyncHandler } from "../../middlewares/validation.js";
import { uploadMediaSchema } from "../../validators/schemas.js";
import { z } from "zod";
import {
  uploadProfileImage,
  uploadProfileCover,
  uploadProfileGallery,
  uploadBikeImage,
  uploadClubLogo,
  uploadClubCover,
  uploadClubGallery,
  uploadRideMedia,
  uploadListingMedia,
  uploadPostMedia,
  deleteMedia,
  generateUploadSignature,
  MediaFolder,
  MediaType,
  MediaValidationError,
} from "../../lib/cloudinary.js";
import prisma from "../../lib/prisma.js";
import { isStaff } from "../../lib/utils/permissions.js";

const router = Router();

// All media routes require authentication
router.use(requireAuth);

function respondUploadError(
  res: Response,
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof MediaValidationError) {
    return ApiResponse.error(
      res,
      error.message,
      error.statusCode,
      error.code,
      error.details,
    );
  }

  return ApiResponse.error(res, fallbackMessage, 500, ErrorCode.UPLOAD_FAILED, {
    message: (error as Error).message,
  });
}

/**
 * @swagger
 * /api/media/upload:
 *   post:
 *     summary: Upload media file
 *     description: |
 *       Upload a media file (base64 encoded) to Cloudinary.
 *       All images and videos are delivered through Cloudinary CDN.
 *     tags: [Media]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - folder
 *               - file
 *             properties:
 *               folder:
 *                 type: string
 *                 enum: [profiles, clubs, rides, listings, posts]
 *                 description: Target folder for upload
 *               type:
 *                 type: string
 *                 enum: [image, video]
 *                 default: image
 *                 description: Media type
 *               file:
 *                 type: string
 *                 description: Base64 encoded file (data:image/jpeg;base64,...)
 *               resourceId:
 *                 type: string
 *                 description: Resource ID (required for clubs, rides, listings, posts)
 *     responses:
 *       200:
 *         description: Media uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     media:
 *                       $ref: '#/components/schemas/MediaUploadResult'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/upload",
  validateBody(
    uploadMediaSchema.extend({
      file: z.string().min(1, "File is required"),
      resourceId: z.string().optional(),
    }),
  ),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { type, folder, file, resourceId } = req.body;

    try {
      let result;

      switch (folder) {
        case "profiles":
          result = await uploadProfileImage(file, session.user.id);
          await prisma.user.update({
            where: { id: session.user.id },
            data: { avatar: result.secureUrl },
          });
          break;
        case "clubs":
          if (!resourceId) {
            return ApiResponse.error(
              res,
              "Resource ID is required for club uploads",
              400,
              ErrorCode.MISSING_REQUIRED_FIELD,
            );
          }
          result = await uploadClubLogo(file, resourceId);
          // Persist the new logo on the club so list/detail screens see it.
          await prisma.club.update({
            where: { id: resourceId },
            data: { image: result.secureUrl },
          });
          break;
        case "rides":
          if (!resourceId) {
            return ApiResponse.error(
              res,
              "Resource ID is required for ride uploads",
              400,
              ErrorCode.MISSING_REQUIRED_FIELD,
            );
          }
          result = await uploadRideMedia(
            file,
            resourceId,
            type === "video" ? MediaType.VIDEO : MediaType.IMAGE,
          );
          // Append uploaded URL to ride.images so the gallery + cover banner
          // populate. Without this the upload succeeded on Cloudinary but
          // the ride record had no record of the image.
          if (type !== "video") {
            const ride = await prisma.ride.findUnique({
              where: { id: resourceId },
              select: { images: true },
            });
            if (ride) {
              await prisma.ride.update({
                where: { id: resourceId },
                data: { images: [...(ride.images ?? []), result.secureUrl] },
              });
            }
          }
          break;
        case "listings":
          if (!resourceId) {
            return ApiResponse.error(
              res,
              "Resource ID is required for listing uploads",
              400,
              ErrorCode.MISSING_REQUIRED_FIELD,
            );
          }
          result = await uploadListingMedia(
            file,
            resourceId,
            type === "video" ? MediaType.VIDEO : MediaType.IMAGE,
          );
          {
            const listing = await prisma.marketplaceListing.findUnique({
              where: { id: resourceId },
              select: { images: true, videos: true },
            });
            if (listing) {
              const isVideo = type === "video";
              await prisma.marketplaceListing.update({
                where: { id: resourceId },
                data: isVideo
                  ? { videos: [...(listing.videos ?? []), result.secureUrl] }
                  : { images: [...(listing.images ?? []), result.secureUrl] },
              });
            }
          }
          break;
        case "posts":
          if (!resourceId) {
            return ApiResponse.error(
              res,
              "Resource ID is required for post uploads",
              400,
              ErrorCode.MISSING_REQUIRED_FIELD,
            );
          }
          result = await uploadPostMedia(
            file,
            resourceId,
            type === "video" ? MediaType.VIDEO : MediaType.IMAGE,
          );
          break;
        default:
          return ApiResponse.error(
            res,
            "Invalid folder",
            400,
            ErrorCode.INVALID_INPUT,
          );
      }

      ApiResponse.success(
        res,
        { media: result, imageUrl: result.secureUrl },
        "Media uploaded successfully",
      );
    } catch (error) {
      console.error("Media upload error:", error);
      return respondUploadError(res, error, "Failed to upload media");
    }
  }),
);

/**
 * @swagger
 * /api/media/upload/profile:
 *   post:
 *     summary: Upload profile avatar
 *     description: Upload user profile picture. Image is automatically resized to 400x400px and delivered via Cloudinary.
 *     tags: [Media]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 description: Base64 encoded image (data:image/jpeg;base64,...)
 *     responses:
 *       200:
 *         description: Profile image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     media:
 *                       $ref: '#/components/schemas/MediaUploadResult'
 *                     imageUrl:
 *                       type: string
 *                       format: uri
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/upload/profile",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { file } = req.body;

    if (!file) {
      return ApiResponse.error(
        res,
        "File is required",
        400,
        ErrorCode.MISSING_REQUIRED_FIELD,
      );
    }

    try {
      const result = await uploadProfileImage(file, session.user.id);

      // Update user's image in database
      await prisma.user.update({
        where: { id: session.user.id },
        data: { avatar: result.secureUrl },
      });

      ApiResponse.success(
        res,
        {
          media: result,
          imageUrl: result.secureUrl,
        },
        "Profile image uploaded successfully",
      );
    } catch (error) {
      console.error("Profile upload error:", error);
      return respondUploadError(res, error, "Failed to upload profile image");
    }
  }),
);

/**
 * @swagger
 * /api/media/upload/profile/cover:
 *   post:
 *     summary: Upload profile cover image
 *     description: Upload user profile cover image. Image is automatically resized to 1200x400px and delivered via Cloudinary.
 *     tags: [Media]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 description: Base64 encoded image (data:image/jpeg;base64,...)
 *     responses:
 *       200:
 *         description: Cover image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     media:
 *                       $ref: '#/components/schemas/MediaUploadResult'
 *                     imageUrl:
 *                       type: string
 *                       format: uri
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/upload/profile/cover",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { file } = req.body;

    if (!file) {
      return ApiResponse.error(
        res,
        "File is required",
        400,
        ErrorCode.MISSING_REQUIRED_FIELD,
      );
    }

    try {
      const result = await uploadProfileCover(file, session.user.id);

      // Update user's cover image in database
      await prisma.user.update({
        where: { id: session.user.id },
        data: { coverImage: result.secureUrl },
      });

      ApiResponse.success(
        res,
        {
          media: result,
          imageUrl: result.secureUrl,
        },
        "Profile cover image uploaded successfully",
      );
    } catch (error) {
      console.error("Profile cover upload error:", error);
      return respondUploadError(
        res,
        error,
        "Failed to upload profile cover image",
      );
    }
  }),
);

/**
 * @swagger
 * /api/media/upload/profile/gallery:
 *   post:
 *     summary: Upload profile gallery image
 *     description: Upload image to user's gallery. Images are delivered via Cloudinary.
 *     tags: [Media]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 description: Base64 encoded image
 *     responses:
 *       200:
 *         description: Gallery image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     media:
 *                       $ref: '#/components/schemas/MediaUploadResult'
 *                     imageUrl:
 *                       type: string
 *                       format: uri
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/upload/profile/gallery",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { file } = req.body;

    if (!file) {
      return ApiResponse.error(
        res,
        "File is required",
        400,
        ErrorCode.MISSING_REQUIRED_FIELD,
      );
    }

    try {
      const result = await uploadProfileGallery(file, session.user.id);

      ApiResponse.success(
        res,
        {
          media: result,
          imageUrl: result.secureUrl,
        },
        "Gallery image uploaded successfully",
      );
    } catch (error) {
      console.error("Gallery upload error:", error);
      return respondUploadError(res, error, "Failed to upload gallery image");
    }
  }),
);

/**
 * @swagger
 * /api/media/upload/club/{clubId}:
 *   post:
 *     summary: Upload club logo or cover image
 *     description: Upload club logo (500x500px) or cover image (1200x400px). Must be club owner. Images are delivered via Cloudinary.
 *     tags: [Media]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clubId
 *         required: true
 *         schema:
 *           type: string
 *         description: Club ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 description: Base64 encoded image
 *               type:
 *                 type: string
 *                 enum: [logo, cover]
 *                 default: logo
 *                 description: Image type
 *     responses:
 *       200:
 *         description: Club image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     media:
 *                       $ref: '#/components/schemas/MediaUploadResult'
 *                     imageUrl:
 *                       type: string
 *                       format: uri
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not club owner
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/upload/club/:clubId",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { clubId } = req.params;
    const { file, type = "logo" } = req.body; // type: "logo" or "cover"

    if (!file) {
      return ApiResponse.error(
        res,
        "File is required",
        400,
        ErrorCode.MISSING_REQUIRED_FIELD,
      );
    }

    // Verify ownership
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { ownerId: true },
    });

    if (!club) {
      return ApiResponse.notFound(
        res,
        "Club not found",
        ErrorCode.CLUB_NOT_FOUND,
      );
    }

    if (club.ownerId !== session.user.id && !isStaff(session.user.roles)) {
      return ApiResponse.forbidden(
        res,
        "You don't have permission to upload images for this club",
      );
    }

    try {
      let result;
      if (type === "cover") {
        result = await uploadClubCover(file, clubId);
        await prisma.club.update({
          where: { id: clubId },
          data: { coverImage: result.secureUrl },
        });
      } else {
        result = await uploadClubLogo(file, clubId);
        await prisma.club.update({
          where: { id: clubId },
          data: { image: result.secureUrl },
        });
      }

      ApiResponse.success(
        res,
        {
          media: result,
          imageUrl: result.secureUrl,
        },
        `Club ${type} uploaded successfully`,
      );
    } catch (error) {
      console.error("Club upload error:", error);
      return respondUploadError(res, error, `Failed to upload club ${type}`);
    }
  }),
);

/**
 * @swagger
 * /api/media/upload/club/{clubId}/gallery:
 *   post:
 *     summary: Upload club gallery image
 *     description: Upload image to club's gallery. Must be club owner. Images are delivered via Cloudinary.
 *     tags: [Media]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clubId
 *         required: true
 *         schema:
 *           type: string
 *         description: Club ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 description: Base64 encoded image
 *     responses:
 *       200:
 *         description: Club gallery image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     media:
 *                       $ref: '#/components/schemas/MediaUploadResult'
 *                     imageUrl:
 *                       type: string
 *                       format: uri
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not club owner
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/upload/club/:clubId/gallery",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { clubId } = req.params;
    const { file } = req.body;

    if (!file) {
      return ApiResponse.error(
        res,
        "File is required",
        400,
        ErrorCode.MISSING_REQUIRED_FIELD,
      );
    }

    // Verify ownership
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { ownerId: true },
    });

    if (!club) {
      return ApiResponse.notFound(
        res,
        "Club not found",
        ErrorCode.CLUB_NOT_FOUND,
      );
    }

    if (club.ownerId !== session.user.id && !isStaff(session.user.roles)) {
      return ApiResponse.forbidden(
        res,
        "You don't have permission to upload images for this club",
      );
    }

    try {
      const result = await uploadClubGallery(file, clubId);
      const updatedClub = await prisma.club.update({
        where: { id: clubId },
        data: {
          gallery: {
            push: result.secureUrl,
          },
        },
        select: { id: true, gallery: true },
      });

      ApiResponse.success(
        res,
        {
          media: result,
          imageUrl: result.secureUrl,
          gallery: updatedClub.gallery,
        },
        "Club gallery image uploaded successfully",
      );
    } catch (error) {
      console.error("Club gallery upload error:", error);
      return respondUploadError(
        res,
        error,
        "Failed to upload club gallery image",
      );
    }
  }),
);

/**
 * @swagger
 * /api/media/upload/bike/{bikeId}:
 *   post:
 *     summary: Upload bike image
 *     description: |
 *       Upload image for a specific bike. Must own the bike. Image is resized to 1000x750px and delivered via Cloudinary.
 *       Images are appended to the bike's photo gallery (up to 5 photos per bike); the most recently
 *       uploaded photo also mirrors into the legacy single-photo `image` field for back-compat.
 *     tags: [Media]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bikeId
 *         required: true
 *         schema:
 *           type: string
 *         description: Bike ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 description: Base64 encoded image
 *     responses:
 *       200:
 *         description: Bike image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     media:
 *                       $ref: '#/components/schemas/MediaUploadResult'
 *                     imageUrl:
 *                       type: string
 *                       format: uri
 *                     images:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Updated array of all bike images (capped at 5)
 *       400:
 *         description: File required or max photos reached
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not bike owner
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/upload/bike/:bikeId",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { bikeId } = req.params;
    const { file } = req.body;

    if (!file) {
      return ApiResponse.error(
        res,
        "File is required",
        400,
        ErrorCode.MISSING_REQUIRED_FIELD,
      );
    }

    // Verify ownership
    const bike = await prisma.bike.findUnique({
      where: { id: bikeId },
      select: { userId: true, images: true },
    });

    if (!bike) {
      return ApiResponse.notFound(res, "Bike not found", ErrorCode.NOT_FOUND);
    }

    if (bike.userId !== session.user.id && !isStaff(session.user.roles)) {
      return ApiResponse.forbidden(
        res,
        "You don't have permission to upload images for this bike",
      );
    }

    // Check max photo limit
    const currentImages = bike.images ?? [];
    if (currentImages.length >= 5) {
      return ApiResponse.error(
        res,
        "Maximum 5 photos allowed per bike",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    try {
      const result = await uploadBikeImage(file, bikeId);
      const updatedImages = [...currentImages, result.secureUrl];

      // Update bike's image gallery in database; mirror the latest photo
      // into the legacy single-photo `image` field for back-compat.
      await prisma.bike.update({
        where: { id: bikeId },
        data: { image: result.secureUrl, images: updatedImages },
      });

      ApiResponse.success(
        res,
        {
          media: result,
          imageUrl: result.secureUrl,
          images: updatedImages,
        },
        "Bike image uploaded successfully",
      );
    } catch (error) {
      console.error("Bike upload error:", error);
      return respondUploadError(res, error, "Failed to upload bike image");
    }
  }),
);

/**
 * @swagger
 * /api/media/upload/listing/{listingId}:
 *   post:
 *     summary: Upload listing image
 *     description: |
 *       Upload image for a marketplace listing. Must be the seller/owner of the listing.
 *       Images are automatically resized to 1000x1000px and delivered via Cloudinary CDN.
 *       Sellers can upload up to 10 images per listing.
 *     tags: [Media]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: listingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Marketplace listing ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 description: Base64 encoded image (data:image/jpeg;base64,...)
 *     responses:
 *       200:
 *         description: Listing image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     media:
 *                       $ref: '#/components/schemas/MediaUploadResult'
 *                     imageUrl:
 *                       type: string
 *                       format: uri
 *                       description: Cloudinary CDN URL for the uploaded image
 *                     listing:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         images:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: Updated array of all listing images
 *       400:
 *         description: File required or max images reached
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not the listing owner
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/upload/listing/:listingId",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { listingId } = req.params;
    const { file, type = "image" } = req.body as {
      file?: string;
      type?: "image" | "video";
    };

    if (!file) {
      return ApiResponse.error(
        res,
        "File is required",
        400,
        ErrorCode.MISSING_REQUIRED_FIELD,
      );
    }

    // Verify ownership
    const listing = await prisma.marketplaceListing.findUnique({
      where: { id: listingId },
      select: { sellerId: true, images: true, videos: true },
    });

    if (!listing) {
      return ApiResponse.notFound(
        res,
        "Listing not found",
        ErrorCode.LISTING_NOT_FOUND,
      );
    }

    if (listing.sellerId !== session.user.id) {
      return ApiResponse.forbidden(
        res,
        "You don't have permission to upload media for this listing",
      );
    }

    const uploadType = type === "video" ? MediaType.VIDEO : MediaType.IMAGE;

    // Check max media limits
    const currentImages = listing.images || [];
    const currentVideos = listing.videos || [];
    if (uploadType === MediaType.IMAGE && currentImages.length >= 10) {
      return ApiResponse.error(
        res,
        "Maximum 10 images allowed per listing",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    if (uploadType === MediaType.VIDEO && currentVideos.length >= 3) {
      return ApiResponse.error(
        res,
        "Maximum 3 videos allowed per listing",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    try {
      const result = await uploadListingMedia(file, listingId, uploadType);

      // Add uploaded URL to listing media arrays
      const updatedListing = await prisma.marketplaceListing.update({
        where: { id: listingId },
        data: {
          ...(uploadType === MediaType.IMAGE
            ? { images: [...currentImages, result.secureUrl] }
            : { videos: [...currentVideos, result.secureUrl] }),
        },
        select: { id: true, images: true, videos: true },
      });

      ApiResponse.success(
        res,
        {
          media: result,
          imageUrl: result.secureUrl,
          mediaType: uploadType === MediaType.VIDEO ? "video" : "image",
          listing: updatedListing,
        },
        `Listing ${uploadType === MediaType.VIDEO ? "video" : "image"} uploaded successfully`,
      );
    } catch (error) {
      console.error("Listing upload error:", error);
      return respondUploadError(res, error, "Failed to upload listing image");
    }
  }),
);

/**
 * @swagger
 * /api/media/{publicId}:
 *   delete:
 *     summary: Delete media file
 *     description: Delete a media file from Cloudinary by its public ID.
 *     tags: [Media]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicId
 *         required: true
 *         schema:
 *           type: string
 *         description: Cloudinary public ID of the media
 *       - in: query
 *         name: resourceType
 *         schema:
 *           type: string
 *           enum: [image, video]
 *           default: image
 *         description: Resource type
 *     responses:
 *       200:
 *         description: Media deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete(
  "/:publicId",
  asyncHandler(async (req: Request, res: Response) => {
    const { publicId } = req.params;
    const { resourceType = "image" } = req.query as any;

    try {
      const success = await deleteMedia(publicId, resourceType);

      if (success) {
        ApiResponse.success(res, null, "Media deleted successfully");
      } else {
        ApiResponse.error(
          res,
          "Failed to delete media",
          500,
          ErrorCode.INTERNAL_ERROR,
        );
      }
    } catch (error) {
      console.error("Media delete error:", error);
      return ApiResponse.error(
        res,
        "Failed to delete media",
        500,
        ErrorCode.INTERNAL_ERROR,
      );
    }
  }),
);

/**
 * @swagger
 * /api/media/signature:
 *   post:
 *     summary: Generate upload signature
 *     description: Generate a signature for direct client-side uploads to Cloudinary. This allows frontend to upload directly to Cloudinary without passing through the backend.
 *     tags: [Media]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - folder
 *             properties:
 *               folder:
 *                 type: string
 *                 enum: [profiles, clubs, rides, listings, posts]
 *                 description: Target folder for upload
 *     responses:
 *       200:
 *         description: Upload signature generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     signature:
 *                       $ref: '#/components/schemas/UploadSignature'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post(
  "/signature",
  asyncHandler(async (req: Request, res: Response) => {
    const { folder } = req.body;

    const validFolders: Record<string, MediaFolder> = {
      profiles: MediaFolder.PROFILES,
      clubs: MediaFolder.CLUBS,
      rides: MediaFolder.RIDES,
      listings: MediaFolder.LISTINGS,
      posts: MediaFolder.POSTS,
    };

    if (!folder || !validFolders[folder]) {
      return ApiResponse.error(
        res,
        "Valid folder is required",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    const signature = generateUploadSignature(validFolders[folder]);

    ApiResponse.success(res, { signature }, "Upload signature generated");
  }),
);

export default router;
