import { z } from "zod";

export const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export const updateBrandingSchema = z.object({
  siteName: z.string().min(1).max(50).optional(),
  siteUrl: z.string().url().optional(),
  supportEmail: z.string().email().optional(),
  tagline: z.string().max(100).optional(),

  logoUrl: z.string().url("Must be a valid URL").optional(),
  iconUrl: z.string().url("Must be a valid URL").optional(),
  faviconUrl: z.string().url("Must be a valid URL").nullable().optional(),

  primaryColor: z
    .string()
    .regex(HEX_COLOR_REGEX, "Must be a valid hex color code (e.g. #ff1d2d)")
    .optional(),
  deepColor: z
    .string()
    .regex(HEX_COLOR_REGEX, "Must be a valid hex color code (e.g. #b3151f)")
    .optional(),
  canvasColor: z
    .string()
    .regex(HEX_COLOR_REGEX, "Must be a valid hex color code (e.g. #0d0d0f)")
    .optional(),
  surfaceColor: z
    .string()
    .regex(HEX_COLOR_REGEX, "Must be a valid hex color code (e.g. #1c1c1e)")
    .optional(),
  borderColor: z
    .string()
    .regex(HEX_COLOR_REGEX, "Must be a valid hex color code (e.g. #3a3a3c)")
    .optional(),

  fontFamily: z.string().min(1).max(50).optional(),
  emailHeaderBadge: z.string().min(1).max(30).optional(),
});

export type UpdateBrandingDTO = z.infer<typeof updateBrandingSchema>;

export interface BrandingConfig {
  siteName: string;
  siteUrl: string;
  supportEmail: string;
  tagline: string;

  logoUrl: string;
  iconUrl: string;
  faviconUrl: string | null;

  primaryColor: string;
  deepColor: string;
  canvasColor: string;
  surfaceColor: string;
  borderColor: string;

  fontFamily: string;
  emailHeaderBadge: string;
  updatedAt?: Date;
}
