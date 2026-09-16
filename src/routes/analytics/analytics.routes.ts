import { Router, Request, Response } from "express";
import {
  clientTelemetryEventsTotal,
  clientGpsJitterMeters,
  clientWebVitals,
  getMetricsSummary,
} from "../../lib/metrics.js";
import { ApiResponse } from "../../lib/utils/apiResponse.js";
import prisma from "../../lib/prisma.js";
import mongoose from "../../lib/mongodb.js";
import { getRedisClient } from "../../lib/socket.js";

const router = Router();

/**
 * @swagger
 * /api/analytics/track:
 *   post:
 *     summary: Ingest client-side performance and telemetry events
 *     description: Accepts client telemetry from web and mobile apps and pipes into Prometheus
 *     tags: [Analytics]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               platform:
 *                 type: string
 *                 enum: [ios, android, web]
 *               events:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Events accepted successfully
 */
router.post("/track", (req: Request, res: Response) => {
  try {
    const { platform = "unknown", events = [] } = req.body || {};

    if (Array.isArray(events)) {
      for (const ev of events) {
        const eventType = String(ev.eventType || ev.name || "general");
        clientTelemetryEventsTotal.inc({ platform: String(platform), event_type: eventType });

        if (eventType === "gps_jitter" && typeof ev.value === "number") {
          clientGpsJitterMeters.observe({ platform: String(platform) }, ev.value);
        }

        if (eventType === "web_vital" && typeof ev.value === "number" && ev.metric) {
          clientWebVitals.observe({ metric: String(ev.metric) }, ev.value);
        }
      }
    }

    ApiResponse.success(res, { ingested: events.length }, "Telemetry ingested");
  } catch (error) {
    ApiResponse.badRequest(res, "Failed to ingest telemetry");
  }
});

/**
 * @swagger
 * /api/analytics/system-metrics:
 *   get:
 *     summary: Retrieve real-time structured metrics summary for Admin Dashboard
 *     description: Returns aggregated Prometheus metrics, process stats, riding counts, and DB latencies as JSON
 *     tags: [Analytics]
 *     responses:
 *       200:
 *         description: Metrics summary object
 */
router.get("/system-metrics", async (_req: Request, res: Response) => {
  try {
    const summary = await getMetricsSummary();

    // Check database dependencies
    const pgStart = process.hrtime.bigint();
    let pgStatus: "up" | "down" = "up";
    let pgError: string | null = null;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      pgStatus = "down";
      pgError = (e as Error).message;
    }
    const pgLatency = Number(process.hrtime.bigint() - pgStart) / 1_000_000;

    const mongoConfigured = Boolean(process.env.MONGODB_URI);
    const mongoStart = process.hrtime.bigint();
    let mongoStatus: "up" | "down" | "not_configured" = mongoConfigured ? "up" : "not_configured";
    let mongoError: string | null = null;
    if (mongoConfigured) {
      try {
        await mongoose.connection.db?.admin().ping();
      } catch (e) {
        mongoStatus = "down";
        mongoError = (e as Error).message;
      }
    }
    const mongoLatency = mongoConfigured ? Number(process.hrtime.bigint() - mongoStart) / 1_000_000 : null;

    const redisClient = getRedisClient();
    const redisConfigured = Boolean(redisClient);
    const redisStart = process.hrtime.bigint();
    let redisStatus: "up" | "down" | "not_configured" = redisConfigured ? "up" : "not_configured";
    let redisError: string | null = null;
    if (redisClient) {
      try {
        await redisClient.ping();
      } catch (e) {
        redisStatus = "down";
        redisError = (e as Error).message;
      }
    }
    const redisLatency = redisConfigured ? Number(process.hrtime.bigint() - redisStart) / 1_000_000 : null;

    res.json({
      success: true,
      data: {
        ...summary,
        dependencies: {
          postgres: {
            name: "PostgreSQL",
            status: pgStatus,
            latencyMs: Number(pgLatency.toFixed(2)),
            error: pgError,
          },
          mongodb: {
            name: "MongoDB",
            status: mongoStatus,
            latencyMs: mongoLatency !== null ? Number(mongoLatency.toFixed(2)) : null,
            error: mongoError,
          },
          redis: {
            name: "Redis",
            status: redisStatus,
            latencyMs: redisLatency !== null ? Number(redisLatency.toFixed(2)) : null,
            error: redisError,
          },
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: (error as Error).message || "Failed to load metrics summary",
    });
  }
});

export default router;
