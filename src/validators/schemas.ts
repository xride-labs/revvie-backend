import { z } from "zod";

// ========================================
// Common Schemas
// ========================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Accepts both CUID (email/password auth) and Firebase/Google UID formats
const idSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_-]{20,36}$/,
    "Invalid ID format",
  );

export const idParamSchema = z.object({
  id: idSchema,
});

// ========================================
// Auth Schemas
// ========================================

export const registerSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

export const sendOtpSchema = z.object({
  phone: z
    .string()
    .min(10, "Phone number must be at least 10 digits")
    .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format (E.164)"),
});

export const verifyOtpSchema = z.object({
  phone: z
    .string()
    .min(10, "Phone number must be at least 10 digits")
    .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format"),
  otp: z
    .string()
    .length(6, "OTP must be 6 digits")
    .regex(/^\d+$/, "OTP must contain only digits"),
});

export const phoneLoginSchema = z.object({
  phone: z
    .string()
    .min(10, "Phone number must be at least 10 digits")
    .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format (E.164)"),
  otp: z
    .string()
    .length(6, "OTP must be 6 digits")
    .regex(/^\d+$/, "OTP must contain only digits"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email format"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export const verifyEmailSchema = z.object({
  email: z.string().email("Invalid email format"),
  token: z.string().min(1, "Token is required"),
});

// ========================================
// User Schemas
// ========================================

export const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  username: z.string().min(2).max(50).optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  dob: z.string().datetime().optional(),
  bloodType: z
    .enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])
    .optional(),
  avatar: z.string().url("Invalid avatar URL").optional(),
  coverImage: z.string().url("Invalid cover image URL").optional(),
  socialLinks: z.record(z.string(), z.string().url("Invalid URL")).optional(),
  ghostModeEnabled: z.boolean().optional(),
  interests: z.array(z.string()).optional(),
  activityLevel: z.enum(["Casual", "Regular", "Enthusiast", "Pro"]).optional(),
  level: z.number().int().min(0).max(100).optional(),
  onboardingCompleted: z.boolean().optional(),
});

export const createBikeSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  // Year is optional from the client; the route defaults to the current year
  // so the quick-add flow during onboarding (make + model only) works.
  year: z.number().int().min(1900).optional(),
  type: z
    .enum([
      "SPORT",
      "CRUISER",
      "TOURING",
      "ADVENTURE",
      "NAKED",
      "CAFE_RACER",
      "DUAL_SPORT",
      "SCOOTER",
      "COMMUTER",
      "SUPERBIKE",
      "OTHER",
    ])
    .optional(),
  engineCc: z.number().int().positive().optional(),
  color: z.string().optional(),
  licensePlate: z.string().optional(),
  vin: z.string().optional(),
  odo: z.number().int().min(0).optional(),
  isPrimary: z.boolean().optional(),
  image: z.string().url().optional(),
  modifications: z.any().optional(),
});

export const updateBikeSchema = createBikeSchema.partial();

export type CreateBikeInput = z.infer<typeof createBikeSchema>;
export type UpdateBikeInput = z.infer<typeof updateBikeSchema>;
export const updateUserSchema = updateProfileSchema.extend({
  email: z.string().email("Invalid email format").optional(),
  username: z.string().min(2).max(50).optional(),
  phone: z.string().min(10).max(20).optional(),
});

export const userQuerySchema = paginationSchema.extend({
  role: z
    .enum(["ADMIN", "CO_ADMIN", "CLUB_OWNER", "RIDER", "SELLER"])
    .optional(),
  search: z.string().optional(),
});

const contactMatchItemSchema = z
  .object({
    name: z.string().max(120).optional(),
    phone: z.string().max(30).optional(),
    email: z.string().email("Invalid email format").optional(),
  })
  .refine((value) => !!value.phone || !!value.email, {
    message: "Each contact must include at least a phone or email",
  });

export const matchContactsSchema = z.object({
  contacts: z.array(contactMatchItemSchema).min(1).max(500),
});

// ========================================
// Ride Schemas
// ========================================

// Title is min 1 (not 3) to match the mobile create form, which only requires
// a non-empty title before submit.
//
// experienceLevel/pace are kept as free strings rather than enums because the
// mobile client uses lowercase values ("intermediate", "spirited", …) while
// the legacy admin/web stack uses Title-cased values. The DB column is a
// String, so we just trust the client.
//
// routeData accepts either a string (already JSON-stringified) or any object
// (we serialize before persisting). This holds the encoded route polyline so
// the ride detail screen can re-render the planned route.
export const createRideSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  startLocation: z.string().min(1, "Start location is required").max(500),
  endLocation: z.string().max(500).optional(),
  experienceLevel: z.string().max(50).optional(),
  xpRequired: z.number().int().min(0).optional(),
  pace: z.string().max(50).optional(),
  distance: z.number().positive("Distance must be positive").optional(),
  duration: z.number().int().positive("Duration must be positive").optional(),
  scheduledAt: z.string().datetime().optional().or(z.date()),
  keepPermanently: z.boolean().default(false), // Flag to prevent auto-deletion
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  startLat: z.number().min(-90).max(90).optional(),
  startLng: z.number().min(-180).max(180).optional(),
  endLat: z.number().min(-90).max(90).optional(),
  endLng: z.number().min(-180).max(180).optional(),
  waypoints: z
    .array(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        name: z.string().max(500).optional(),
        address: z.string().max(500).optional(),
      }),
    )
    .max(10)
    .optional(),
  routeData: z
    .union([z.string(), z.record(z.string(), z.any()), z.array(z.any())])
    .optional(),
  maxParticipants: z.number().int().positive().max(1000).optional(),
  friendGroupId: idSchema.optional(),
  image: z.string().optional(), // initial banner data URL (base64) — uploaded after create
  privacyLevel: z.enum(["PUBLIC", "FRIENDS_ONLY", "INCOGNITO"]).optional(),
});

export const updateRideSchema = createRideSchema.partial();

export const rideQuerySchema = paginationSchema.extend({
  status: z
    .enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
    .optional(),
  experienceLevel: z.enum(["Beginner", "Intermediate", "Expert"]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
});

export const joinRideSchema = z.object({
  message: z.string().max(500).optional(),
});

export const updateParticipantStatusSchema = z.object({
  status: z.enum(["ACCEPTED", "DECLINED", "CANCELLED"]),
});

// ========================================
// Club Schemas
// ========================================

export const createClubSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(200),
  description: z.string().max(2000).optional(),
  location: z.string().max(500).optional(),
  clubType: z.string().max(100).optional(),
  isPublic: z.boolean().default(true),
  requiresLicense: z.boolean().default(false),
  image: z.string().url("Invalid image URL").optional(),
  coverImage: z.string().url("Invalid cover image URL").optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const updateClubSchema = createClubSchema.partial();

export const clubQuerySchema = paginationSchema.extend({
  isPublic: z.coerce.boolean().optional(),
  verified: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["MEMBER", "OFFICER", "ADMIN"]),
});

// ========================================
// Marketplace Schemas
// ========================================

const httpsUrl = (label: string) =>
  z
    .string()
    .url(`Invalid ${label} URL`)
    .transform((u) => u.replace(/^http:\/\//, "https://"));

export const createListingSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(200),
  description: z.string().max(5000).optional(),
  price: z.number().positive("Price must be positive"),
  currency: z
    .string()
    .length(3, "Currency must be 3 characters")
    .default("INR"),
  images: z.array(httpsUrl("image")).max(10).optional(),
  videos: z.array(httpsUrl("video")).max(3).optional(),
  category: z
    .enum(["Motorcycle", "Gear", "Accessories", "Parts", "Other"])
    .optional(),
  subcategory: z.string().max(100).optional(),
  specifications: z.string().max(2000).optional(), // JSON string
  condition: z.enum(["New", "Like New", "Good", "Fair", "Poor"]).optional(),
  locationLabel: z.string().max(200).optional(),
  allowBids: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // Club scoping: when posting inside a club's market, `clubId` links the
  // listing to that club. `visibility` controls reach — CLUB_ONLY keeps it to
  // members; PUBLIC also shows it in the global marketplace. CLUB_ONLY is only
  // meaningful with a clubId (enforced in the route handler).
  clubId: z.string().optional().nullable(),
  visibility: z.enum(["PUBLIC", "CLUB_ONLY"]).optional().default("PUBLIC"),
});

export const updateListingSchema = createListingSchema.partial().extend({
  status: z.enum(["ACTIVE", "SOLD", "INACTIVE"]).optional(),
});

export const listingQuerySchema = paginationSchema.extend({
  category: z.string().optional(),
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  condition: z.string().optional(),
  status: z.enum(["ACTIVE", "SOLD", "INACTIVE"]).optional(),
  search: z.string().optional(),
  featured: z.enum(["true", "false"]).optional(),
  sellerId: z.string().optional(),
});

export const createReviewSchema = z.object({
  rating: z
    .number()
    .min(1, "Rating must be at least 1")
    .max(5, "Rating must be at most 5"),
  comment: z.string().max(1000).optional(),
});

export const createListingOfferSchema = z.object({
  offeredPrice: z.number().positive("Offer amount must be positive"),
  message: z.string().max(1000).optional(),
});

export const updateListingOfferSchema = z.object({
  status: z.enum([
    "NEGOTIATING",
    "ACCEPTED",
    "DEAL_DONE",
    "REJECTED",
    "WITHDRAWN",
    "EXPIRED",
  ]),
  offeredPrice: z.number().positive("Offer amount must be positive").optional(),
  message: z.string().max(1000).optional(),
});

// ========================================
// Discovery Feed Schemas
// ========================================

export const discoveryFeedQuerySchema = z.object({
  lat: z.coerce
    .number()
    .min(-90, "Latitude must be >= -90")
    .max(90, "Latitude must be <= 90"),
  lng: z.coerce
    .number()
    .min(-180, "Longitude must be >= -180")
    .max(180, "Longitude must be <= 180"),
  radiusKm: z.coerce.number().positive().max(500).default(50),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  rideType: z.enum(["Beginner", "Intermediate", "Expert"]).optional(),
  difficulty: z.enum(["Leisurely", "Moderate", "Fast"]).optional(),
  upcomingOnly: z.coerce.boolean().optional(),
});

export type DiscoveryFeedQuery = z.infer<typeof discoveryFeedQuerySchema>;

// ========================================
// Post/Feed Schemas
// ========================================

export const createPostSchema = z.object({
  type: z.enum(["ride", "content", "listing", "club-activity"]),
  content: z.string().max(5000).optional(),
  images: z.array(z.string().url("Invalid image URL")).max(10).optional(),
  rideId: idSchema.optional(),
  listingId: idSchema.optional(),
  clubId: idSchema.optional(),
});

export const updatePostSchema = createPostSchema.partial();

export const postQuerySchema = paginationSchema.extend({
  type: z.enum(["ride", "content", "listing", "club-activity"]).optional(),
  authorId: idSchema.optional(),
});

export const createCommentSchema = z.object({
  content: z.string().min(1, "Comment cannot be empty").max(1000),
});

// ========================================
// Media Upload Schemas
// ========================================

export const uploadMediaSchema = z.object({
  type: z.enum(["image", "video"]),
  folder: z.enum(["profiles", "clubs", "rides", "listings", "posts"]),
});

// ========================================
// Admin Schemas
// ========================================

export const updateUserRoleSchema = z.object({
  role: z.enum(["ADMIN", "CO_ADMIN", "MODERATOR", "RIDER", "SELLER", "CLUB_OWNER", "CLUB_ADMIN", "CLUB_MODERATOR", "BRAND_OWNER", "BRAND_ADMIN", "BRAND_MODERATOR"]),
});

export const adminUsersQuerySchema = paginationSchema.extend({
  role: z
    .enum(["ADMIN", "CO_ADMIN", "MODERATOR", "CLUB_OWNER", "CLUB_ADMIN", "CLUB_MODERATOR", "BRAND_OWNER", "BRAND_ADMIN", "BRAND_MODERATOR", "RIDER", "SELLER"])
    .optional(),
  status: z.enum(["active", "pending"]).optional(),
  search: z.string().optional(),
});

export const createAdminUserSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  name: z.string().min(2).max(100).optional(),
  username: z.string().min(2).max(50).optional(),
  phone: z.string().min(10).max(20).optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  activityLevel: z.enum(["Casual", "Regular", "Enthusiast", "Pro"]).optional(),
  emailVerified: z.boolean().optional(),
  phoneVerified: z.boolean().optional(),
  roles: z
    .array(z.enum(["ADMIN", "CO_ADMIN", "MODERATOR", "RIDER", "SELLER", "CLUB_OWNER", "CLUB_ADMIN", "CLUB_MODERATOR", "BRAND_OWNER", "BRAND_ADMIN", "BRAND_MODERATOR"]))
    .min(1)
    .optional(),
});

export const updateAdminUserSchema = z
  .object({
    email: z.string().email("Invalid email format").optional(),
    name: z.string().min(2).max(100).optional(),
    username: z.string().min(2).max(50).optional(),
    phone: z.string().min(10).max(20).nullable().optional(),
    bio: z.string().max(500).nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    activityLevel: z
      .enum(["Casual", "Regular", "Enthusiast", "Pro"])
      .optional(),
    emailVerified: z.boolean().optional(),
    phoneVerified: z.boolean().optional(),
    roles: z
      .array(z.enum(["ADMIN", "CO_ADMIN", "MODERATOR", "RIDER", "SELLER", "CLUB_OWNER", "CLUB_ADMIN", "CLUB_MODERATOR", "BRAND_OWNER", "BRAND_ADMIN", "BRAND_MODERATOR"]))
      .optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field must be provided",
  });

export const weeklyActivityQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export const adminSettingsUpdateSchema = z
  .object({
    siteName: z.string().min(2).max(80).optional(),
    siteUrl: z.string().url().optional(),
    supportEmail: z.string().email().optional(),
    timezone: z.string().max(64).optional(),
    defaultCurrency: z.string().length(3).toUpperCase().optional(),
    maintenanceMode: z.boolean().optional(),
    allowRegistration: z.boolean().optional(),
    marketplaceEnabled: z.boolean().optional(),
    clubCreationEnabled: z.boolean().optional(),
    requireAdmin2FA: z.boolean().optional(),
    sessionTimeoutMinutes: z.number().int().min(5).max(1440).optional(),
    passwordStrength: z.enum(["basic", "medium", "strong"]).optional(),
    loginAttempts: z.number().int().min(1).max(20).optional(),
    notifyNewUser: z.boolean().optional(),
    notifyNewReports: z.boolean().optional(),
    notifyClubVerification: z.boolean().optional(),
    notifySystemAlerts: z.boolean().optional(),
    notifyDailySummary: z.boolean().optional(),
    smtpHost: z.string().max(120).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpUser: z.string().max(120).optional(),
    smtpPass: z.string().max(200).optional(),
    fromEmail: z.string().email().optional(),
    fromName: z.string().max(120).optional(),
    welcomeEmailSubject: z.string().max(200).optional(),
    welcomeEmailBody: z.string().max(4000).optional(),
    primaryColor: z.string().max(20).optional(),
    darkModeDefault: z.boolean().optional(),
    compactMode: z.boolean().optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field must be provided",
  });

export const updateReportSchema = z.object({
  status: z.enum(["pending", "investigating", "resolved", "dismissed"]),
  resolution: z.string().max(2000).optional(),
});

export const adminNotificationsQuerySchema = paginationSchema.extend({
  userId: idSchema.optional(),
  unreadOnly: z.coerce.boolean().optional(),
  type: z
    .enum([
      "RIDE_INVITE",
      "CLUB_INVITE",
      "CLUB_JOIN_REQUEST",
      "CLUB_JOIN_ACCEPTED",
      "CLUB_ANNOUNCEMENT",
      "RIDE_JOIN_REQUEST",
      "RIDE_JOIN_ACCEPTED",
      "RIDE_REMINDER",
      "RIDE_CANCELLED",
      "MARKETPLACE_MESSAGE",
      "LISTING_SOLD",
      "LISTING_OFFER",
      "LISTING_INTERESTED",
      "MESSAGE",
      "FOLLOW",
      "COMMENT",
      "LIKE",
      "FRIEND_REQUEST",
    ])
    .optional(),
  search: z.string().max(120).optional(),
});

export const adminStatsQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  granularity: z.enum(["day", "week", "month"]).default("day"),
});

export const createReportSchema = z.object({
  type: z.enum([
    "post",
    "comment",
    "ride",
    "club",
    "listing",
    "user",
    "message",
  ]),
  title: z.string().min(3).max(160),
  description: z.string().min(5).max(2000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  reportedItemId: idSchema,
  reportedItemType: z.string().min(2).max(50).optional(),
});

export const clubDiscoverQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  clubType: z.string().optional(),
  location: z.string().optional(),
});

export const myClubsQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
});

export const updatePreferencesSchema = z
  .object({
    rideReminders: z.boolean().optional(),
    serviceReminderKm: z.number().int().min(500).max(50000).optional(),
    darkMode: z.boolean().optional(),
    units: z.enum(["metric", "imperial"]).optional(),
    openToInvite: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    emailNotifications: z.boolean().optional(),
    smsNotifications: z.boolean().optional(),
    profileVisibility: z.enum(["public", "friends", "private"]).optional(),
    allowDMsFrom: z.enum(["everyone", "friends", "none"]).optional(),
    allowFriendRequestsFrom: z.enum(["everyone", "none"]).optional(),
    showLocation: z.boolean().optional(),
    showBikes: z.boolean().optional(),
    showStats: z.boolean().optional(),
    notifyRides: z.boolean().optional(),
    notifyClubs: z.boolean().optional(),
    notifyMarketplace: z.boolean().optional(),
    notifySocial: z.boolean().optional(),
    // Mobile-only persistence flags. Without these the PATCH errors with
    // "Validation failed for body" the moment the user toggles the switch.
    lowDataMode: z.boolean().optional(),
    sensorMode: z.boolean().optional(),
    ghostMode: z.boolean().optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one preference must be provided",
  });

export const myListingsQuerySchema = paginationSchema.extend({
  status: z.enum(["ACTIVE", "SOLD", "INACTIVE"]).optional(),
  category: z.string().optional(),
  search: z.string().optional(),
});

export const feedQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  type: z.enum(["ride", "content", "listing", "club-activity"]).optional(),
  authorId: idSchema.optional(),
});

export const friendRequestsQuerySchema = paginationSchema;

export const friendGroupQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
});

export const userRidesQuerySchema = paginationSchema.extend({
  status: z
    .enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
    .optional(),
  search: z.string().optional(),
});

export const userClubsQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
});

// Type exports
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateRideInput = z.infer<typeof createRideSchema>;
export type UpdateRideInput = z.infer<typeof updateRideSchema>;
export type CreateClubInput = z.infer<typeof createClubSchema>;
export type UpdateClubInput = z.infer<typeof updateClubSchema>;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type CreateListingOfferInput = z.infer<typeof createListingOfferSchema>;
export type UpdateListingOfferInput = z.infer<typeof updateListingOfferSchema>;
export type MatchContactsInput = z.infer<typeof matchContactsSchema>;
export type DiscoveryFeedQueryInput = z.infer<typeof discoveryFeedQuerySchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
