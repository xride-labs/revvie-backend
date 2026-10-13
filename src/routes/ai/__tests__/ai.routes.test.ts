import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { aiRouter } from "../ai.routes.js";

vi.mock("../../../ai/agent.js", () => ({
  runAgentTurn: vi.fn(async (msg: string, _ctx: any) => ({
    reply: `Echo: ${msg}`,
    toolCallsExecuted: [],
  })),
}));

vi.mock("../../../config/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "test-user-id", role: "RIDER" };
    next();
  },
}));

describe("AI Routes Integration & Credit Limits", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/ai", aiRouter);

  it("POST /api/ai/chat returns agent reply and remaining credits for authenticated user", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "Find beginner rides" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reply).toBe("Echo: Find beginner rides");
    expect(res.body.credits).toBeDefined();
    expect(res.body.credits.remaining).toBeGreaterThanOrEqual(0);
  });

  it("GET /api/ai/credits returns current credit balance", async () => {
    const res = await request(app).get("/api/ai/credits");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.credits.limit).toBe(20);
  });

  it("POST /api/ai/chat rejects empty message", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ message: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Message is required");
  });
});
