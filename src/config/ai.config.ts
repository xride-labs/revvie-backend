export const aiConfig = {
  baseUrl:
    process.env.AI_BASE_URL ||
    (process.env.OPENROUTER_API_KEY ? "https://openrouter.ai/api/v1" : "http://localhost:11434/v1"),
  apiKey: process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY || "ollama",
  model:
    process.env.AI_MODEL ||
    (process.env.OPENROUTER_API_KEY ? "meta-llama/llama-3.3-70b-instruct" : "qwen2.5:14b"),
  maxTokens: Number(process.env.AI_MAX_TOKENS || 1024),
  temperature: Number(process.env.AI_TEMPERATURE || 0.2),
  // External MCP access is disabled unless both are set; there is no default key.
  mcpApiKey: process.env.MCP_API_KEY || "",
  mcpServiceUserId: process.env.MCP_SERVICE_USER_ID || "",
  dailyCreditsLimit: Number(process.env.AI_DAILY_CREDITS_LIMIT || 20),
};
