/**
 * Media retention policies for Cloudinary-backed assets.
 *
 * Each policy maps to a TTL in milliseconds. The daily cleanup job (in
 * src/jobs/scheduler.ts) finds rows where `expiresAt < now` and removes them
 * from both Postgres and Cloudinary.
 *
 * Add new policies here rather than ad-hoc dates at call sites — keeping the
 * vocabulary centralised means we can audit/adjust retention in one place.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionPolicy =
  | "SHARED_24H"
  | "RIDE_30D"
  | "RIDE_45D_MAX"
  | "PROFILE_PERMANENT"
  | "LISTING_PERMANENT"
  | "POST_PERMANENT";

const POLICY_TTL_MS: Record<RetentionPolicy, number | null> = {
  // Phase 5 spec: chat-shared media expires in 24h by default.
  SHARED_24H: 1 * DAY_MS,
  // Ride media (route preview, summary thumbnail) sticks around for the
  // standard ride retention window.
  RIDE_30D: 30 * DAY_MS,
  // Phase 5 spec: maximum retention for shared media is 45 days even when
  // a longer policy is requested. Use this as the hard cap upper bound.
  RIDE_45D_MAX: 45 * DAY_MS,
  // Permanent assets — profile avatars, listing photos, posts. These stay
  // forever (or until the parent entity is deleted via cascading FK).
  PROFILE_PERMANENT: null,
  LISTING_PERMANENT: null,
  POST_PERMANENT: null,
};

/** Compute the deadline for a given policy. Null means "keep forever". */
export function computeMediaExpiresAt(
  policy: RetentionPolicy,
): Date | null {
  const ttl = POLICY_TTL_MS[policy];
  if (ttl == null) return null;
  return new Date(Date.now() + ttl);
}

/**
 * Pick a sensible default retention policy from the upload folder. Folders
 * are the same Cloudinary folder names already used by the upload routes.
 */
export function policyForFolder(folder: string): RetentionPolicy {
  switch (folder) {
    case "profiles":
      return "PROFILE_PERMANENT";
    case "listings":
      return "LISTING_PERMANENT";
    case "posts":
      return "POST_PERMANENT";
    case "rides":
      return "RIDE_30D";
    case "chat":
    case "chat-attachments":
      return "SHARED_24H";
    default:
      // Anything we don't recognise gets the strict default. Better to lose
      // an asset early than to leak storage indefinitely from a forgotten
      // upload site.
      return "SHARED_24H";
  }
}
