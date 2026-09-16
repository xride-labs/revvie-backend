import express from "express";
import request from "supertest";
import { ApiResponse, ErrorCode } from "./lib/utils/apiResponse.js";
import { healthHandler } from "./routes/health.js";
import { metricsHandler } from "./lib/metrics.js";
import analyticsRoutes from "./routes/analytics/analytics.routes.js";

describe("http contracts", () => {
  const app = express();

  app.use(express.json());
  app.get("/health", healthHandler);
  app.get("/metrics", metricsHandler);
  app.use("/api/analytics", analyticsRoutes);

  app.use((_req, res) => {
    ApiResponse.notFound(res, "Endpoint not found", ErrorCode.NOT_FOUND);
  });

  it("GET /health returns descriptive health contract", async () => {
    const response = await request(app).get("/health");

    expect([200, 503]).toContain(response.status);
    expect(["ok", "degraded", "down"]).toContain(response.body.status);
    expect(typeof response.body.timestamp).toBe("string");
    expect(typeof response.body.environment).toBe("string");
    expect(typeof response.body.uptimeSeconds).toBe("number");
    expect(typeof response.body.latencyMs).toBe("number");

    expect(response.body.checks).toBeDefined();
    expect(response.body.checks.postgres).toBeDefined();
    expect(["up", "down"]).toContain(response.body.checks.postgres.status);
    expect(typeof response.body.checks.postgres.latencyMs).toBe("number");

    expect(response.body.checks.mongodb).toBeDefined();
    expect(["up", "down", "not_configured"]).toContain(
      response.body.checks.mongodb.status,
    );

    if (response.body.checks.mongodb.status === "not_configured") {
      expect(response.body.checks.mongodb.latencyMs).toBeNull();
      expect(response.body.checks.mongodb.readyState).toBeNull();
    }
  });

  it("unknown routes return standard error response format", async () => {
    const response = await request(app).get("/unknown");

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("GET /metrics returns Prometheus text exposition format", async () => {
    const response = await request(app).get("/metrics");

    expect(response.status).toBe(200);
    expect(response.text).toContain("revvie_http_requests_total");
    expect(response.text).toContain("revvie_active_rides");
  });

  it("POST /api/analytics/track accepts client telemetry", async () => {
    const response = await request(app)
      .post("/api/analytics/track")
      .send({
        platform: "android",
        events: [{ eventType: "gps_jitter", value: 3.5 }],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.ingested).toBe(1);
  });

  it("GET /api/analytics/system-metrics returns structured JSON for admin dashboard", async () => {
    const response = await request(app).get("/api/analytics/system-metrics");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(response.body.data.system).toBeDefined();
    expect(typeof response.body.data.system.heapUsedMb).toBe("number");
    expect(response.body.data.traffic).toBeDefined();
    expect(typeof response.body.data.traffic.totalRequests).toBe("number");
    expect(response.body.data.riding).toBeDefined();
    expect(typeof response.body.data.riding.activeRides).toBe("number");
    expect(response.body.data.dependencies).toBeDefined();
  });
});
