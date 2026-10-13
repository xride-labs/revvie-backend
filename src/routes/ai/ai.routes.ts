import { timingSafeEqual } from "node:crypto";
import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../config/auth.js";
import { runAgentTurn } from "../../ai/agent.js";
import { checkAndConsumeCredit, refundCredit, getRemainingCredits } from "../../ai/credits.service.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createRevvieMcpServer } from "../../mcp/server.js";
import { aiConfig } from "../../config/ai.config.js";

export const aiRouter = Router();

// Rate limiter: 20 requests per minute per IP/user
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests. Please slow down and try again shortly." },
});

/**
 * @swagger
 * /api/ai/credits:
 *   get:
 *     tags: [AI]
 *     summary: Remaining daily AI co-pilot credits for the signed-in rider
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Credits used, remaining and the daily limit
 *       401:
 *         description: Not signed in
 */
// GET /api/ai/credits — check remaining daily credits
aiRouter.get("/credits", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const credits = await getRemainingCredits(userId);
  return res.json({
    success: true,
    credits,
  });
});

/**
 * @swagger
 * /api/ai/chat:
 *   post:
 *     tags: [AI]
 *     summary: Send a message to the Revvie co-pilot
 *     description: Runs one assistant turn. The model can search rides, create a ride, read the rider's profile and garage, and look up bike specs. Costs one daily credit, refunded if the model call fails.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 2000 }
 *               history:
 *                 type: array
 *                 description: Up to 10 previous user/assistant turns. System and tool turns are ignored.
 *                 items:
 *                   type: object
 *                   properties:
 *                     role: { type: string, enum: [user, assistant] }
 *                     content: { type: string }
 *     responses:
 *       200:
 *         description: Assistant reply, the tools it ran, and the remaining credits
 *       429:
 *         description: Rate limit or daily credits exhausted
 */
// POST /api/ai/chat — run agent turn with credit deduction
aiRouter.post("/chat", aiRateLimiter, requireAuth, async (req: Request, res: Response) => {
  const { message, history } = req.body ?? {};

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }

  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  // Enforce Daily Credit System
  const creditStatus = await checkAndConsumeCredit(userId);
  if (!creditStatus.allowed) {
    return res.status(429).json({
      error: `Daily AI credits limit reached (${creditStatus.limit} prompts/day). Your credits will reset at midnight UTC.`,
      remainingCredits: 0,
      dailyLimit: creditStatus.limit,
    });
  }

  try {
    const result = await runAgentTurn(message, { userId, userRole: (req as any).user?.role }, history || []);
    return res.json({
      success: true,
      reply: result.reply,
      toolCallsExecuted: result.toolCallsExecuted,
      credits: {
        remaining: creditStatus.remaining,
        limit: creditStatus.limit,
      },
    });
  } catch (error: any) {
    console.error("AI Agent Turn Error:", error);
    await refundCredit(userId);
    return res.status(500).json({
      error: "Failed to generate AI response. Please ensure your LLM provider is active.",
    });
  }
});

// External MCP clients (Cursor, Claude Code, ...). Disabled unless MCP_API_KEY and
// MCP_SERVICE_USER_ID are configured; tools act as that one user, never as an admin.
const mcpTransports = new Map<string, SSEServerTransport>();

function mcpAuthorized(req: Request): boolean {
  const expected = aiConfig.mcpApiKey;
  const provided = req.headers["x-api-key"];
  if (!expected || !aiConfig.mcpServiceUserId || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @swagger
 * /api/ai/mcp/sse:
 *   get:
 *     tags: [AI]
 *     summary: Model Context Protocol server (SSE) for external MCP clients
 *     description: Disabled unless MCP_API_KEY and MCP_SERVICE_USER_ID are configured. Send the key in the x-api-key header. Tools act as the configured service user.
 *     parameters:
 *       - { name: x-api-key, in: header, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: text/event-stream
 *       401:
 *         description: Missing or wrong key
 */
aiRouter.get("/mcp/sse", async (req: Request, res: Response) => {
  if (!mcpAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized MCP connection." });
  }

  const transport = new SSEServerTransport("/api/ai/mcp/messages", res);
  mcpTransports.set(transport.sessionId, transport);
  res.on("close", () => mcpTransports.delete(transport.sessionId));

  const server = createRevvieMcpServer({ userId: aiConfig.mcpServiceUserId });
  await server.connect(transport);
});

aiRouter.post("/mcp/messages", async (req: Request, res: Response) => {
  if (!mcpAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized MCP connection." });
  }
  const transport = mcpTransports.get(String(req.query.sessionId ?? ""));
  if (!transport) {
    return res.status(404).json({ error: "Unknown MCP session." });
  }
  await transport.handlePostMessage(req, res, req.body);
});
