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
