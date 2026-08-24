import "dotenv/config"; // must be first — ESM hoists all imports before body code runs
import { initSentry, setupSentryErrorHandler } from "./lib/sentry.js";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

import { auth } from "./config/auth.js";
import { CORS_OPTIONS } from "./config/trustedOrigins.js";
import { toNodeHandler } from "better-auth/node";
import { connectMongoDB } from "./lib/mongodb.js";
import { setupSwagger } from "./config/swagger.js";
import {
  accountRoutes,
  userRoutes,
  rideRoutes,
  clubRoutes,
  marketplaceRoutes,
  adminRoutes,
  mediaRoutes,
  feedRoutes,
  discoveryRoutes,
  chatRoutes,
  locationRoutes,
  friendGroupRoutes,
  friendshipRoutes,
  notificationRoutes,
  paymentsRoutes,
  eventRoutes,
  publicRoutes,
  businessRoutes,
  adsRoutes,
  discountRoutes,
  bulkRoutes,
  catalogRoutes,
} from "./routes/index.js";
import {
  initializeScheduledJobs,
  initializeSelfPing,
} from "./jobs/scheduler.js";
import { ApiResponse, ErrorCode } from "./lib/utils/apiResponse.js";
import { createSocketServer } from "./lib/socket.js";
import { connectPostgres } from "./lib/prisma.js";
import { healthHandler } from "./routes/health.js";
import {
  maintenanceModeMiddleware,
  signupGateMiddleware,
} from "./middlewares/appSettings.js";
import { globalErrorHandler } from "./middlewares/errorHandler.js";
import { welcomeHtml } from "./data/welcome.js";

initSentry(); // env vars are loaded; initialize before any middleware

export const app = express();
export const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;
let hasRegisteredDevErrorConsole = false;
const isProduction = process.env.NODE_ENV === "production";

function registerDevelopmentErrorConsole() {
  if (process.env.NODE_ENV !== "development" || hasRegisteredDevErrorConsole) {
    return;
  }

  process.on("unhandledRejection", (reason) => {
    console.error("[DEV][UNHANDLED_REJECTION]", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[DEV][UNCAUGHT_EXCEPTION]", error);
  });

  hasRegisteredDevErrorConsole = true;
}

// Trust exactly one reverse proxy in production; trust none in local dev.
app.set("trust proxy", isProduction ? 1 : false);

// Apply CORS configuration
app.use(cors(CORS_OPTIONS));

// Rate limiting — protect against brute-force and DoS

// Strict limit on auth endpoints (sign-in, sign-up, OTP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 20 : 1000, // 20 attempts / 15min in prod
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many auth attempts. Try again in 15 minutes.",
    },
  },
});

// Global limit on the rest of the API
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: isProduction ? 120 : 10000, // 120 req/min in prod
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: "RATE_LIMITED", message: "Too many requests. Slow down." },
  },
});

app.use("/api/auth", authLimiter);
app.use("/api", apiLimiter);

// Log auth origin headers in dev to diagnose Better Auth origin checks
app.use("/api/auth", (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV !== "production") {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const referer = req.headers.referer;
    console.log("[AUTH] Origin check", { origin, host, referer });
    if (!origin && host) {
      req.headers.origin = `http://${host}`;
    }
  }
  next();
});

// Block new registrations when disabled (auth endpoints only)
app.use("/api/auth", signupGateMiddleware);

// Better Auth handler — MUST be mounted BEFORE express.json()
// See: https://www.better-auth.com/docs/integrations/express
app.all("/api/auth/*", toNodeHandler(auth));

// Dodo webhook signature verification requires the raw request body.
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));

// Body parsing middleware (AFTER Better Auth).
// Limit raised to 25mb because the mobile client sends base64-encoded images
// inline (avatars, ride/club banners, listing photos) and ride creation
// includes the full route polyline geometry. Default 100kb is too small.
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Maintenance mode gate for API routes (excludes /api/auth and allowlisted paths)
app.use("/api", maintenanceModeMiddleware);

// Static public assets (email logos, etc.) — resolved relative to the repo
// root regardless of whether we're running from src (tsx) or dist (node).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");
app.use(
  "/static",
  express.static(publicDir, {
    maxAge: "7d",
    etag: true,
    fallthrough: true,
  }),
);

// Setup Swagger/OpenAPI documentation
setupSwagger(app);

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns API health details, including dependency checks and probe latencies
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API is healthy or degraded but serving traffic
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [ok, degraded, down]
 *                   example: ok
 *                 uptimeSeconds:
 *                   type: number
 *                   example: 1824.31
 *                 latencyMs:
 *                   type: number
 *                   example: 3.22
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 environment:
 *                   type: string
 *                   example: development
 *                 checks:
 *                   type: object
 *                   properties:
 *                     postgres:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           enum: [up, down]
 *                           example: up
 *                         latencyMs:
 *                           type: number
 *                           nullable: true
 *                           example: 4.18
 *                         error:
 *                           type: string
 *                           nullable: true
 *                     mongodb:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           enum: [up, down, not_configured]
 *                           example: up
 *                         latencyMs:
 *                           type: number
 *                           nullable: true
 *                           example: 6.74
 *                         readyState:
 *                           type: number
 *                           nullable: true
 *                           example: 1
 *                         error:
 *                           type: string
 *                           nullable: true
 *       503:
 *         description: API is unhealthy (critical dependency down)
 */
app.get("/health", healthHandler);

// Account routes (profile, verify-email, change-password)
app.use("/api/account", accountRoutes);
app.use("/api/users", userRoutes);
app.use("/api/rides", rideRoutes);
app.use("/api/clubs", clubRoutes);
app.use("/api/marketplace", marketplaceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/posts", feedRoutes);
app.use("/api/discover", discoveryRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/friend-groups", friendGroupRoutes);
app.use("/api/friends", friendshipRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/business", businessRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/discounts", discountRoutes);
app.use("/api/bulk", bulkRoutes);
app.use("/api/catalog", catalogRoutes);

// Base URL welcome page
app.get("/", (req: Request, res: Response) => {
  res.send(welcomeHtml);
});

// 404 handler
app.use((req: Request, res: Response) => {
  ApiResponse.notFound(res, "Endpoint not found", ErrorCode.NOT_FOUND);
});

// Sentry error handler — must be before the global error handler
setupSentryErrorHandler(app);

// Global error handler
app.use(globalErrorHandler);

// Start server
export async function startServer() {
  try {
    console.log("[SERVER] Starting Revvie Backend Server...");
    registerDevelopmentErrorConsole();

    // Validate required production env vars
    if (process.env.NODE_ENV === "production") {
      const required = [
        "DATABASE_URL",
        "BETTER_AUTH_BASE_URL",
        "BETTER_AUTH_SECRET",
      ];
      const missing = required.filter((key) => !process.env[key]);
      if (missing.length > 0) {
        throw new Error(
          `Missing required production env vars: ${missing.join(", ")}`,
        );
      }
    }

    // Bind the port first so Render detects it immediately.
    // All initialisation (migrations, DB connections) happens after.
    await new Promise<void>((resolve, reject) => {
      httpServer.listen(PORT, () => resolve());
      httpServer.once("error", reject);
    });

    const baseUrl =
      process.env.BETTER_AUTH_BASE_URL || `http://localhost:${PORT}`;
    if (isProduction) {
      console.log("[SERVER] Revvie backend started successfully");
      console.log(`[SERVER] Environment: production`);
      console.log(`[SERVER] Base URL: ${baseUrl}`);
      console.log(`[SERVER] Health: ${baseUrl}/health`);
    }

    // Run pending migrations in production (replaces the shell-level
    // prisma:deploy step so the port is already bound when they run).
    if (isProduction) {
      const { execSync } = await import("child_process");
      console.log("[SERVER] Running database migrations...");
      execSync("bunx prisma migrate deploy", { stdio: "inherit" });
      console.log("[SERVER] Migrations complete");
    }

    // Connect to PostgreSQL (required for auth and core APIs)
    await connectPostgres();

    // Connect to MongoDB (required for chat)
    try {
      await connectMongoDB();
    } catch (mongoError) {
      console.warn(
        "⚠️  MongoDB connection failed, chat features will be unavailable",
      );
      console.error(mongoError);
    }

    // Initialize Socket.io for real-time chat
    createSocketServer(httpServer);
    console.log("[SERVER] Socket.io chat server initialized");

    // Initialize scheduled background jobs
    console.log("[SERVER] Initializing scheduled jobs...");
    initializeScheduledJobs();

    // Keep the backend warm on free-tier hosts with periodic self-pings.
    initializeSelfPing(Number(PORT));
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}
