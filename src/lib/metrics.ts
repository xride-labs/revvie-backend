import client from "prom-client";
import type { Request, Response, NextFunction } from "express";

// Initialize the global Prometheus Registry
export const register = new client.Registry();

// Enable default Node.js runtime process metrics (Heap, CPU, GC, Event Loop)
client.collectDefaultMetrics({
  register,
  prefix: "revvie_",
});

// ─── HTTP Request Metrics ───────────────────────────────────────────────────

export const httpRequestsTotal = new client.Counter({
  name: "revvie_http_requests_total",
  help: "Total number of HTTP requests processed by the backend",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "revvie_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// ─── WebSocket & Real-Time Telemetry ────────────────────────────────────────

export const websocketConnectionsActive = new client.Gauge({
  name: "revvie_websocket_connections_active",
  help: "Number of active Socket.IO connections currently connected",
  registers: [register],
});

export const websocketEventsTotal = new client.Counter({
  name: "revvie_websocket_events_total",
  help: "Total number of Socket.IO events processed",
  labelNames: ["event"],
  registers: [register],
});

export const websocketLocationPingsTotal = new client.Counter({
  name: "revvie_websocket_location_pings_total",
  help: "Total live GPS location coordinates received over WebSocket",
  registers: [register],
});

// ─── Motorcycle Convoy & Ride Business Metrics ──────────────────────────────

export const activeRidesGauge = new client.Gauge({
  name: "revvie_active_rides",
  help: "Current number of in-progress live rides (solo and group convoys)",
  registers: [register],
});

export const ridesStartedTotal = new client.Counter({
  name: "revvie_rides_started_total",
  help: "Total rides started",
  labelNames: ["type"], // "solo" | "group"
  registers: [register],
});

export const ridesCompletedTotal = new client.Counter({
  name: "revvie_rides_completed_total",
  help: "Total rides successfully finished and archived",
  registers: [register],
});

export const sosAlertsActive = new client.Gauge({
  name: "revvie_sos_alerts_active",
  help: "Active emergency SOS distress signals across all riders",
  registers: [register],
});

export const sosAlertsTotal = new client.Counter({
  name: "revvie_sos_alerts_total",
  help: "Total emergency SOS distress alerts triggered",
  labelNames: ["reason"],
  registers: [register],
});

// ─── Database & Cache Performance Metrics ───────────────────────────────────

export const dbQueryDurationSeconds = new client.Histogram({
  name: "revvie_db_query_duration_seconds",
  help: "Duration of database queries in seconds",
  labelNames: ["database", "operation"], // database: "postgres" | "mongodb" | "redis"
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
});

export const cacheHitsTotal = new client.Counter({
  name: "revvie_cache_hits_total",
  help: "Total Redis cache hits",
  labelNames: ["cache_type"],
  registers: [register],
});

export const cacheMissesTotal = new client.Counter({
  name: "revvie_cache_misses_total",
  help: "Total Redis cache misses",
  labelNames: ["cache_type"],
  registers: [register],
});

// ─── Client-Side Performance & Telemetry Ingestion ─────────────────────────

export const clientTelemetryEventsTotal = new client.Counter({
  name: "revvie_client_telemetry_events_total",
  help: "Client telemetry events reported from mobile app and web frontend",
  labelNames: ["platform", "event_type"], // platform: "ios" | "android" | "web"
  registers: [register],
});

export const clientGpsJitterMeters = new client.Histogram({
  name: "revvie_client_gps_jitter_meters",
  help: "Reported mobile GPS accuracy / jitter in meters",
  labelNames: ["platform"],
  buckets: [1, 3, 5, 10, 20, 50, 100, 250],
  registers: [register],
});

export const clientWebVitals = new client.Histogram({
  name: "revvie_client_web_vitals",
  help: "Core Web Vitals reported by the web client (values in ms)",
  labelNames: ["metric"], // "LCP" | "FID" | "CLS" | "TTFB"
  buckets: [50, 100, 250, 500, 1000, 2500, 4000],
  registers: [register],
});

// ─── Route Normalization & Middleware ───────────────────────────────────────

/**
 * Normalizes dynamic path parameters to prevent high metric cardinality.
 * e.g. /api/rides/cm23456789/breaks -> /api/rides/:id/breaks
 */
export function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  // Strip trailing slashes and query strings
  let clean = path.split("?")[0].replace(/\/+$/, "");
  if (!clean) clean = "/";

  // Replace standard IDs: UUIDs, Mongo ObjectIDs, CUIDs, numeric IDs
  return clean
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/[0-9a-f]{24}/gi, ":id") // MongoDB ObjectId
    .replace(/\bc[a-z0-9]{20,30}\b/gi, ":id") // CUID
    .replace(/\b\d+\b/g, ":id"); // Numeric IDs
}

/**
 * Express middleware to automatically track all HTTP request counts and durations.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip metrics scraping path itself from polluting request metrics
  if (req.path === "/metrics") {
    next();
    return;
  }

  const start = process.hrtime();

  res.on("finish", () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds + nanoseconds / 1e9;

    const route = req.route?.path
      ? `${req.baseUrl || ""}${req.route.path}`
      : normalizePath(req.originalUrl || req.url);

    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode.toString(),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, duration);
  });

  next();
}

/**
 * Handler for the /metrics scrape endpoint.
 */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
  try {
    const bearer = process.env.METRICS_BEARER_TOKEN;
    if (bearer && req.headers.authorization !== `Bearer ${bearer}`) {
      // In Kubernetes cluster scraping, prometheus can either pass bearer or scrape internal pod IP directly
      if (process.env.METRICS_REQUIRE_AUTH === "true") {
        res.status(401).send("Unauthorized");
        return;
      }
    }

    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end((err as Error).message);
  }
}

export interface MetricsSummary {
  timestamp: string;
  uptimeSeconds: number;
  uptimeFormatted: string;
  system: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    heapPercent: number;
    cpuUserSeconds: number;
    cpuSystemSeconds: number;
    nodeVersion: string;
    platform: string;
  };
  traffic: {
    totalRequests: number;
    statusCodes: {
      "2xx": number;
      "3xx": number;
      "4xx": number;
      "5xx": number;
    };
    errorRatePct: number;
    requestsByMethod: Record<string, number>;
    topRoutes: Array<{ route: string; method: string; count: number; errorCount: number }>;
    latencyDistribution: Array<{ range: string; count: number }>;
  };
  riding: {
    activeWebsockets: number;
    activeRides: number;
    locationPingsTotal: number;
    sosAlertsTotal: number;
    ridesStartedTotal: number;
    ridesCompletedTotal: number;
  };
}

export async function getMetricsSummary(): Promise<MetricsSummary> {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

  const metrics = await register.getMetricsAsJSON();

  let totalRequests = 0;
  const statusCodes = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  const requestsByMethod: Record<string, number> = {};
  const routeMap: Record<string, { count: number; errorCount: number; method: string }> = {};
  let activeWebsockets = 0;
  let activeRides = 0;
  let locationPingsTotal = 0;
  let sosAlertsTotal = 0;
  let ridesStartedTotal = 0;
  let ridesCompletedTotal = 0;
  let cpuUserSeconds = 0;
  let cpuSystemSeconds = 0;

  const latencyBuckets: Record<string, number> = {
    "< 10ms": 0,
    "10ms - 50ms": 0,
    "50ms - 250ms": 0,
    "250ms - 1s": 0,
    "> 1s": 0,
  };

  for (const metric of metrics) {
    if (metric.name === "revvie_http_requests_total") {
      for (const val of metric.values) {
        const v = typeof val.value === "number" ? val.value : 0;
        totalRequests += v;
        const code = String(val.labels?.status_code || "200");
        if (code.startsWith("2")) statusCodes["2xx"] += v;
        else if (code.startsWith("3")) statusCodes["3xx"] += v;
        else if (code.startsWith("4")) statusCodes["4xx"] += v;
        else if (code.startsWith("5")) statusCodes["5xx"] += v;

        const method = String(val.labels?.method || "GET");
        requestsByMethod[method] = (requestsByMethod[method] || 0) + v;

        const route = String(val.labels?.route || "unknown");
        const key = `${method} ${route}`;
        if (!routeMap[key]) {
          routeMap[key] = { count: 0, errorCount: 0, method };
        }
        routeMap[key].count += v;
        if (code.startsWith("4") || code.startsWith("5")) {
          routeMap[key].errorCount += v;
        }
      }
    } else if (metric.name === "revvie_http_request_duration_seconds") {
      for (const val of metric.values) {
        const le = parseFloat(val.labels?.le as string);
        const count = typeof val.value === "number" ? val.value : 0;
        if (!isNaN(le)) {
          if (le <= 0.01) latencyBuckets["< 10ms"] += count;
          else if (le <= 0.05) latencyBuckets["10ms - 50ms"] += count;
          else if (le <= 0.25) latencyBuckets["50ms - 250ms"] += count;
          else if (le <= 1.0) latencyBuckets["250ms - 1s"] += count;
          else latencyBuckets["> 1s"] += count;
        }
      }
    } else if (metric.name === "revvie_websocket_connections_active") {
      activeWebsockets = metric.values[0]?.value ?? 0;
    } else if (metric.name === "revvie_active_rides") {
      activeRides = metric.values[0]?.value ?? 0;
    } else if (metric.name === "revvie_websocket_location_pings_total") {
      locationPingsTotal = metric.values.reduce((sum, v) => sum + (v.value || 0), 0);
    } else if (metric.name === "revvie_sos_alerts_total") {
      sosAlertsTotal = metric.values.reduce((sum, v) => sum + (v.value || 0), 0);
    } else if (metric.name === "revvie_rides_started_total") {
      ridesStartedTotal = metric.values.reduce((sum, v) => sum + (v.value || 0), 0);
    } else if (metric.name === "revvie_rides_completed_total") {
      ridesCompletedTotal = metric.values.reduce((sum, v) => sum + (v.value || 0), 0);
    } else if (metric.name === "revvie_process_cpu_user_seconds_total") {
      cpuUserSeconds = Math.round((metric.values[0]?.value ?? 0) * 100) / 100;
    } else if (metric.name === "revvie_process_cpu_system_seconds_total") {
      cpuSystemSeconds = Math.round((metric.values[0]?.value ?? 0) * 100) / 100;
    }
  }

  const errorTotal = statusCodes["4xx"] + statusCodes["5xx"];
  const errorRatePct = totalRequests > 0 ? Math.round((errorTotal / totalRequests) * 10000) / 100 : 0;

  const topRoutes = Object.entries(routeMap)
    .map(([key, data]) => {
      const [method, ...routeParts] = key.split(" ");
      return {
        method,
        route: routeParts.join(" "),
        count: data.count,
        errorCount: data.errorCount,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const latencyDistribution = Object.entries(latencyBuckets).map(([range, count]) => ({
    range,
    count,
  }));

  const heapUsedMb = Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100;
  const heapTotalMb = Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100;
  const rssMb = Math.round((mem.rss / 1024 / 1024) * 100) / 100;
  const heapPercent = heapTotalMb > 0 ? Math.round((heapUsedMb / heapTotalMb) * 100) : 0;

  return {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(uptime),
    uptimeFormatted,
    system: {
      heapUsedMb,
      heapTotalMb,
      rssMb,
      heapPercent,
      cpuUserSeconds,
      cpuSystemSeconds,
      nodeVersion: process.version,
      platform: process.platform,
    },
    traffic: {
      totalRequests,
      statusCodes,
      errorRatePct,
      requestsByMethod,
      topRoutes,
      latencyDistribution,
    },
    riding: {
      activeWebsockets,
      activeRides,
      locationPingsTotal,
      sosAlertsTotal,
      ridesStartedTotal,
      ridesCompletedTotal,
    },
  };
}
