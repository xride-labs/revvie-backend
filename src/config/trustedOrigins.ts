/**
 * Centralized trusted origins configuration
 * Used by both CORS and Better Auth for consistent origin validation
 */

function parseOrigins(value?: string): string[] {
  if (!value) return [];

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Development local origins
const LOCALHOST_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
  "http://127.0.0.1:3003",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "http://localhost:5000",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://10.0.2.2:8081",
  "http://10.0.2.2:5000",
];

// Mobile/Expo origins
const MOBILE_ORIGINS = [
  "exp://localhost:8081",
  "exp://10.0.2.2:8081",
  "http://10.0.2.2:19000",
  "http://localhost:19000",
  "http://10.0.2.2:19006",
  "http://localhost:19006",
];

// Production origins
const PRODUCTION_ORIGINS = [
  "https://revvie.xride-labs.in",
  "https://api.revvie.xride-labs.in",
  process.env.FRONTEND_URL || "",
  process.env.MOBILE_APP_URL || "",
].filter(Boolean);

// Extra origins can be provided as comma-separated URLs via env.
const ADDITIONAL_ORIGINS = parseOrigins(
  process.env.ADDITIONAL_TRUSTED_ORIGINS || process.env.CORS_ORIGIN,
);

/**
 * Complete list of all trusted origins
 * Used for both CORS and Better Auth origin validation
 */
export const TRUSTED_ORIGINS = [
  ...PRODUCTION_ORIGINS,
  ...LOCALHOST_ORIGINS,
  ...MOBILE_ORIGINS,
  ...ADDITIONAL_ORIGINS,
].filter(Boolean);

/**
 * Checks if an origin matches explicitly trusted origins or wildcard subdomain patterns.
 */
export function isOriginAllowed(origin?: string): boolean {
  if (!origin) return true;
  if (TRUSTED_ORIGINS.includes(origin)) return true;

  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    if (host === "revvie.app" || host.endsWith(".revvie.app")) return true;
    if (host === "xride-labs.in" || host.endsWith(".xride-labs.in")) return true;
    if (host === "localhost" || host.endsWith(".localhost")) return true;
  } catch {
    return false;
  }

  return false;
}

/**
 * CORS configuration using dynamic trusted origin verification
 */
export const CORS_OPTIONS = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "x-tenant-slug",
    "x-tenant-host",
    "x-tenant-type",
    "x-tenant-id",
  ],
};

/**
 * Export origins by category for debugging/logging
 */
export const ORIGINS_BY_CATEGORY = {
  production: PRODUCTION_ORIGINS,
  localhost: LOCALHOST_ORIGINS,
  mobile: MOBILE_ORIGINS,
  additional: ADDITIONAL_ORIGINS,
  all: TRUSTED_ORIGINS,
};
