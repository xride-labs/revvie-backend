import {
  v2 as cloudinary,
  UploadApiOptions,
  UploadApiResponse,
} from "cloudinary";
import { ErrorCode } from "./utils/apiResponse.js";
import { R2_CONFIGURED, isCloudinaryStorageLimitError, uploadToR2 } from "./r2.js";

// Configure Cloudinary. We surface a loud, actionable error at module load
// when any of the three env vars are missing — without this, every upload
// fails with a cryptic "must supply api_key" error from the SDK and the
// problem looks like a code bug rather than a missing Render secret.
const REQUIRED_CLOUDINARY_ENV = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
] as const;

const missingCloudinaryEnv = REQUIRED_CLOUDINARY_ENV.filter(
  (key) => !process.env[key],
);

export const CLOUDINARY_CONFIGURED = missingCloudinaryEnv.length === 0;

if (!CLOUDINARY_CONFIGURED) {
  // Throw in production so the failed deploy is obvious in Render logs.
  // In development we just warn so engineers without a local Cloudinary key
  // can still run the rest of the API.
  const message = `Missing Cloudinary env vars: ${missingCloudinaryEnv.join(", ")}. Image/video uploads will fail.`;
  if (process.env.NODE_ENV === "production") {
    throw new Error(message);
  }
  console.warn(`[CLOUDINARY] ${message}`);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Media type enum
 */
export enum MediaType {
  IMAGE = "image",
  VIDEO = "video",
}

/**
 * Media folder paths for organization
 */
export enum MediaFolder {
  PROFILES = "revvie/profiles",
  PROFILE_COVERS = "revvie/profiles/covers",
  PROFILE_GALLERIES = "revvie/profiles/galleries",
  BIKES = "revvie/bikes",
  CLUBS = "revvie/clubs",
  CLUB_COVERS = "revvie/clubs/covers",
  CLUB_GALLERIES = "revvie/clubs/galleries",
  RIDES = "revvie/rides",
  LISTINGS = "revvie/marketplace",
  POSTS = "revvie/posts",
}

/**
 * Upload result interface
 */
export interface UploadResult {
  publicId: string;
  url: string;
  secureUrl: string;
  format: string;
  width?: number;
  height?: number;
  bytes: number;
  duration?: number; // For videos
  resourceType: string;
  createdAt: string;
  thumbnailUrl?: string;
}

/**
 * Upload options interface
 */
export interface UploadOptions {
  folder: MediaFolder;
  publicId?: string;
  transformation?: any[];
  resourceType?: "image" | "video" | "auto";
  eager?: any[]; // For generating thumbnails/transformations on upload
  tags?: string[];
}

interface MediaPolicy {
  maxBytes: number;
  allowedMimeTypes: string[];
  allowedFormats: string[];
}

const MB = 1024 * 1024;

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

const DATA_URL_REGEX =
  /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n\s]+)$/;

export class MediaValidationError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number = 400,
    code: ErrorCode = ErrorCode.INVALID_INPUT,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MediaValidationError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const IMAGE_POLICIES: Record<MediaFolder, MediaPolicy> = {
  [MediaFolder.PROFILES]: {
    maxBytes: 5 * MB,
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
  },
  [MediaFolder.PROFILE_COVERS]: {
    maxBytes: 8 * MB,
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
  },
  [MediaFolder.PROFILE_GALLERIES]: {
    maxBytes: 10 * MB,
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
  },
  [MediaFolder.BIKES]: {
    maxBytes: 10 * MB,
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
  },
  [MediaFolder.CLUBS]: {
    maxBytes: 8 * MB,
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
  },
  [MediaFolder.CLUB_COVERS]: {
    maxBytes: 10 * MB,
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
  },
  [MediaFolder.CLUB_GALLERIES]: {
    maxBytes: 10 * MB,
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
  },
  [MediaFolder.RIDES]: {
    maxBytes: 12 * MB,
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
  },
  [MediaFolder.LISTINGS]: {
    maxBytes: 10 * MB,
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
  },
  [MediaFolder.POSTS]: {
    maxBytes: 10 * MB,
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    allowedFormats: ["jpg", "jpeg", "png", "webp"],
  },
};

const VIDEO_POLICIES: Partial<Record<MediaFolder, MediaPolicy>> = {
  [MediaFolder.RIDES]: {
    maxBytes: 40 * MB,
    allowedMimeTypes: [...VIDEO_MIME_TYPES],
    allowedFormats: ["mp4", "mov", "webm"],
  },
  [MediaFolder.LISTINGS]: {
    maxBytes: 40 * MB,
    allowedMimeTypes: [...VIDEO_MIME_TYPES],
    allowedFormats: ["mp4", "mov", "webm"],
  },
  [MediaFolder.POSTS]: {
    maxBytes: 40 * MB,
    allowedMimeTypes: [...VIDEO_MIME_TYPES],
    allowedFormats: ["mp4", "mov", "webm"],
  },
};

function parseDataUrl(file: string): {
  mimeType: string;
  base64Payload: string;
  byteLength: number;
} {
  const trimmed = file.trim();
  const match = DATA_URL_REGEX.exec(trimmed);

  if (!match) {
    throw new MediaValidationError(
      "Invalid media payload. Expected a base64 data URL (data:<mime>;base64,...)",
      400,
      ErrorCode.INVALID_INPUT,
    );
  }

  const mimeType = match[1].toLowerCase();
  const base64Payload = match[2].replace(/\s+/g, "");

  if (!base64Payload) {
    throw new MediaValidationError(
      "Media payload is empty",
      400,
      ErrorCode.INVALID_INPUT,
    );
  }

  const byteLength = Buffer.byteLength(base64Payload, "base64");

  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new MediaValidationError(
      "Media payload is invalid or empty",
      400,
      ErrorCode.INVALID_INPUT,
    );
  }

  return {
    mimeType,
    base64Payload,
    byteLength,
  };
}

function resolveUploadPolicy(
  folder: MediaFolder,
  mimeType: string,
  resourceType: "image" | "video" | "auto",
): MediaPolicy {
  const isVideoMime = mimeType.startsWith("video/");
  const isImageMime = mimeType.startsWith("image/");

  if (resourceType === "video" && !isVideoMime) {
    throw new MediaValidationError(
      "Invalid media type. Expected a video payload",
      400,
      ErrorCode.INVALID_INPUT,
    );
  }

  if (resourceType === "image" && !isImageMime) {
    throw new MediaValidationError(
      "Invalid media type. Expected an image payload",
      400,
      ErrorCode.INVALID_INPUT,
    );
  }

  if (isVideoMime) {
    const policy = VIDEO_POLICIES[folder];
    if (!policy) {
      throw new MediaValidationError(
        "Video uploads are not allowed for this media target",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }
    return policy;
  }

  if (!isImageMime) {
    throw new MediaValidationError(
      "Unsupported media payload. Only image and video uploads are allowed",
      400,
      ErrorCode.INVALID_INPUT,
    );
  }

  return IMAGE_POLICIES[folder];
}

function validateMediaPayload(
  file: string,
  options: UploadOptions,
): {
  normalizedDataUrl: string;
  policy: MediaPolicy;
} {
  const { mimeType, base64Payload, byteLength } = parseDataUrl(file);
  const policy = resolveUploadPolicy(
    options.folder,
    mimeType,
    options.resourceType || "auto",
  );

  if (!policy.allowedMimeTypes.includes(mimeType)) {
    throw new MediaValidationError(
      `Unsupported file type ${mimeType}. Allowed types: ${policy.allowedMimeTypes.join(
        ", ",
      )}`,
      400,
      ErrorCode.INVALID_INPUT,
      {
        allowedMimeTypes: policy.allowedMimeTypes,
      },
    );
  }

  if (byteLength > policy.maxBytes) {
    throw new MediaValidationError(
      `Media file is too large. Max allowed size is ${Math.round(policy.maxBytes / MB)}MB`,
      413,
      ErrorCode.INVALID_INPUT,
      {
        maxBytes: policy.maxBytes,
        receivedBytes: byteLength,
      },
    );
  }

  return {
    normalizedDataUrl: `data:${mimeType};base64,${base64Payload}`,
    policy,
  };
}

/**
 * Default image transformations
 */
const imageTransformations = {
  profile: [
    { width: 400, height: 400, crop: "fill", gravity: "face" },
    { quality: "auto:good", fetch_format: "auto", flags: "strip_profile" },
  ],
  profileCover: [
    { width: 1200, height: 400, crop: "fill" },
    { quality: "auto:good", fetch_format: "auto", flags: "strip_profile" },
  ],
  gallery: [
    { width: 1200, height: 1200, crop: "limit" },
    { quality: "auto:good", fetch_format: "auto", flags: "strip_profile" },
  ],
  bikeImage: [
    { width: 1000, height: 750, crop: "limit" },
    { quality: "auto:good", fetch_format: "auto", flags: "strip_profile" },
  ],
  clubLogo: [
    { width: 500, height: 500, crop: "fill" },
    { quality: "auto:good", fetch_format: "auto", flags: "strip_profile" },
  ],
  clubCover: [
    { width: 1200, height: 400, crop: "fill" },
    { quality: "auto:good", fetch_format: "auto", flags: "strip_profile" },
  ],
  ridePhoto: [
    { width: 1200, height: 800, crop: "limit" },
    { quality: "auto:good", fetch_format: "auto", flags: "strip_profile" },
  ],
  listingImage: [
    { width: 1000, height: 1000, crop: "limit" },
    { quality: "auto:good", fetch_format: "auto", flags: "strip_profile" },
  ],
  postImage: [
    { width: 1400, height: 1400, crop: "limit" },
    { quality: "auto:good", fetch_format: "auto", flags: "strip_profile" },
  ],
  thumbnail: [
    { width: 200, height: 200, crop: "fill" },
    { quality: "auto:good", fetch_format: "auto", flags: "strip_profile" },
  ],
};

/**
 * Upload a file to Cloudinary from base64 or URL
 */
export async function uploadMedia(
  file: string, // Base64 string or URL
  options: UploadOptions,
): Promise<UploadResult> {
  const { normalizedDataUrl, policy } = validateMediaPayload(file, options);

  const uploadOptions: UploadApiOptions = {
    folder: options.folder,
    resource_type: options.resourceType || "auto",
    unique_filename: true,
    overwrite: true,
    invalidate: true,
    allowed_formats: policy.allowedFormats,
    max_bytes: policy.maxBytes,
    ...(options.publicId && { public_id: options.publicId }),
    ...(options.transformation && { transformation: options.transformation }),
    ...(options.tags && { tags: options.tags }),
    ...(options.eager && { eager: options.eager }),
  };

  // Extract mime type from the normalised data URL for the R2 fallback path.
  const mimeType = normalizedDataUrl.slice(5, normalizedDataUrl.indexOf(";"));

  try {
    const result: UploadApiResponse = await cloudinary.uploader.upload(
      normalizedDataUrl,
      uploadOptions,
    );

    // Append Cloudinary's version number as a cache-bust query param so
    // mobile <Image> and browser caches fetch the new asset on re-upload.
    const cacheBust = result.version ? `?v=${result.version}` : "";

    return {
      publicId: result.public_id,
      url: result.secure_url + cacheBust,
      secureUrl: result.secure_url + cacheBust,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      duration: result.duration,
      resourceType: result.resource_type,
      createdAt: result.created_at,
      thumbnailUrl: result.eager?.[0]?.secure_url
        ? result.eager[0].secure_url + cacheBust
        : undefined,
    };
  } catch (error) {
    if (isCloudinaryStorageLimitError(error) && R2_CONFIGURED) {
      console.warn(
        "[CLOUDINARY] Storage/plan limit hit — falling back to Cloudflare R2.",
      );
      return uploadToR2(normalizedDataUrl, options.folder, mimeType);
    }

    console.error("Cloudinary upload error:", error);
    throw new Error(`Failed to upload media: ${(error as Error).message}`);
  }
}

/**
 * Upload profile image with face detection
 */
export async function uploadProfileImage(
  file: string,
  userId: string,
): Promise<UploadResult> {
  return uploadMedia(file, {
    folder: MediaFolder.PROFILES,
    publicId: `profile_${userId}`,
    transformation: imageTransformations.profile,
    eager: [imageTransformations.thumbnail],
  });
}

/**
 * Upload profile cover image
 */
export async function uploadProfileCover(
  file: string,
  userId: string,
): Promise<UploadResult> {
  return uploadMedia(file, {
    folder: MediaFolder.PROFILE_COVERS,
    publicId: `cover_${userId}`,
    transformation: imageTransformations.profileCover,
  });
}

/**
 * Upload profile gallery image
 */
export async function uploadProfileGallery(
  file: string,
  userId: string,
): Promise<UploadResult> {
  return uploadMedia(file, {
    folder: MediaFolder.PROFILE_GALLERIES,
    tags: [`user_${userId}`],
    transformation: imageTransformations.gallery,
    eager: [imageTransformations.thumbnail],
  });
}

/**
 * Upload bike image
 */
export async function uploadBikeImage(
  file: string,
  bikeId: string,
): Promise<UploadResult> {
  return uploadMedia(file, {
    folder: MediaFolder.BIKES,
    publicId: `bike_${bikeId}`,
    transformation: imageTransformations.bikeImage,
    eager: [imageTransformations.thumbnail],
  });
}

/**
 * Upload club logo
 */
export async function uploadClubLogo(
  file: string,
  clubId: string,
): Promise<UploadResult> {
  return uploadMedia(file, {
    folder: MediaFolder.CLUBS,
    publicId: `logo_${clubId}`,
    transformation: imageTransformations.clubLogo,
    eager: [imageTransformations.thumbnail],
  });
}

/**
 * Upload club cover image
 */
export async function uploadClubCover(
  file: string,
  clubId: string,
): Promise<UploadResult> {
  return uploadMedia(file, {
    folder: MediaFolder.CLUB_COVERS,
    publicId: `cover_${clubId}`,
    transformation: imageTransformations.clubCover,
  });
}

/**
 * Upload club gallery image
 */
export async function uploadClubGallery(
  file: string,
  clubId: string,
): Promise<UploadResult> {
  return uploadMedia(file, {
    folder: MediaFolder.CLUB_GALLERIES,
    tags: [`club_${clubId}`],
    transformation: imageTransformations.gallery,
    eager: [imageTransformations.thumbnail],
  });
}

/**
 * Upload ride photos/videos
 */
export async function uploadRideMedia(
  file: string,
  rideId: string,
  type: MediaType = MediaType.IMAGE,
): Promise<UploadResult> {
  const options: UploadOptions = {
    folder: MediaFolder.RIDES,
    tags: [`ride_${rideId}`],
    resourceType: type === MediaType.VIDEO ? "video" : "image",
  };

  if (type === MediaType.IMAGE) {
    options.transformation = imageTransformations.ridePhoto;
    options.eager = [imageTransformations.thumbnail];
  } else {
    // Video transformations
    options.eager = [
      { format: "mp4", video_codec: "h264" },
      {
        format: "jpg",
        start_offset: "0",
        transformation: imageTransformations.thumbnail,
      },
    ];
  }

  return uploadMedia(file, options);
}

/**
 * Upload marketplace listing images
 */
export async function uploadListingImage(
  file: string,
  listingId: string,
): Promise<UploadResult> {
  return uploadListingMedia(file, listingId, MediaType.IMAGE);
}

/**
 * Upload marketplace listing image or video
 */
export async function uploadListingMedia(
  file: string,
  listingId: string,
  type: MediaType = MediaType.IMAGE,
): Promise<UploadResult> {
  const options: UploadOptions = {
    folder: MediaFolder.LISTINGS,
    tags: [`listing_${listingId}`],
    resourceType: type === MediaType.VIDEO ? "video" : "image",
  };

  if (type === MediaType.IMAGE) {
    options.transformation = imageTransformations.listingImage;
    options.eager = [imageTransformations.thumbnail];
  } else {
    options.eager = [
      { format: "mp4", video_codec: "h264" },
      {
        format: "jpg",
        start_offset: "0",
        transformation: imageTransformations.thumbnail,
      },
    ];
  }

  return uploadMedia(file, options);
}

/**
 * Upload post media
 */
export async function uploadPostMedia(
  file: string,
  postId: string,
  type: MediaType = MediaType.IMAGE,
): Promise<UploadResult> {
  const options: UploadOptions = {
    folder: MediaFolder.POSTS,
    tags: [`post_${postId}`],
    resourceType: type === MediaType.VIDEO ? "video" : "image",
    eager: [imageTransformations.thumbnail],
  };

  if (type === MediaType.IMAGE) {
    options.transformation = imageTransformations.postImage;
  }

  return uploadMedia(file, options);
}

/**
 * Delete media from Cloudinary
 */
export async function deleteMedia(
  publicId: string,
  resourceType: "image" | "video" = "image",
): Promise<boolean> {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    return result.result === "ok";
  } catch (error) {
    console.error("Cloudinary delete error:", error);
    return false;
  }
}

/**
 * Delete multiple media files
 */
export async function deleteMultipleMedia(
  publicIds: string[],
  resourceType: "image" | "video" = "image",
): Promise<{ deleted: string[]; failed: string[]; notFound: string[] }> {
  try {
    const result = await cloudinary.api.delete_resources(publicIds, {
      resource_type: resourceType,
    });
    const deleted = Object.keys(result.deleted).filter(
      (id) => result.deleted[id] === "deleted",
    );
    // "not_found" means the asset was already gone from Cloudinary — the
    // local DB row is safe to drop so we stop retrying it every night.
    const notFound = Object.keys(result.deleted).filter(
      (id) => result.deleted[id] === "not_found",
    );
    const failed = Object.keys(result.deleted).filter((id) => {
      const status = result.deleted[id];
      return status !== "deleted" && status !== "not_found";
    });
    return { deleted, failed, notFound };
  } catch (error) {
    console.error("Cloudinary bulk delete error:", error);
    return { deleted: [], failed: publicIds, notFound: [] };
  }
}

/**
 * Get media URLs with transformations
 */
export function getOptimizedUrl(
  publicId: string,
  options?: {
    width?: number;
    height?: number;
    crop?: string;
    format?: string;
  },
): string {
  return cloudinary.url(publicId, {
    secure: true,
    transformation: [
      {
        width: options?.width,
        height: options?.height,
        crop: options?.crop || "fill",
        fetch_format: options?.format || "auto",
        quality: "auto",
      },
    ],
  });
}

/**
 * Generate upload signature for direct client uploads
 */
export function generateUploadSignature(
  folder: MediaFolder,
  timestamp: number = Math.round(Date.now() / 1000),
): { signature: string; timestamp: number; cloudName: string; apiKey: string } {
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder },
    process.env.CLOUDINARY_API_SECRET!,
  );

  return {
    signature,
    timestamp,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
    apiKey: process.env.CLOUDINARY_API_KEY!,
  };
}

export default cloudinary;
