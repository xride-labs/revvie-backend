import { z } from "zod";

export const itineraryThemeEnum = z.enum([
  "NAVADURGAS",
  "SEEMADURGAS",
  "WATERBODIES",
  "TREKS",
  "HISTORICAL",
  "COASTAL_DRIVES",
  "MOTO_EVENTS",
  "CHALLENGE_DOCKET"
]);

export const durationTierEnum = z.enum([
  "HALF_DAY",
  "FULL_DAY",
  "WEEKEND",
  "EXPEDITION_WEEK",
  "EXPEDITION_15_DAYS",
  "CUSTOM_DAYS"
]);

export const curatedItinerariesQuerySchema = z.object({
  theme: itineraryThemeEnum.optional(),
  durationTier: durationTierEnum.optional(),
  corridor: z.string().optional(),
  region: z.string().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  sortBy: z.enum(["rating", "distance", "duration"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});

export const scheduleItinerarySchema = z.object({
  scheduledAt: z.string().datetime({ message: "Invalid ISO datetime format for scheduledAt" }),
  title: z.string().min(1).max(150).optional(),
  pace: z.enum(["Leisurely", "Moderate", "Fast"]).optional(),
  experienceLevel: z.enum(["Beginner", "Intermediate", "Advanced", "Hardcore"]).optional(),
  isPrivate: z.boolean().optional().default(false)
});

export const curatedPlacesQuerySchema = z.object({
  corridor: z.string().optional(),
  category: z.string().optional(),
  region: z.string().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});
