import OpenAI from "openai";
import { aiConfig } from "../config/ai.config.js";

let clientInstance: OpenAI | null = null;

export function getAiClient(): OpenAI {
  if (!clientInstance) {
    const defaultHeaders: Record<string, string> = {};
    if (aiConfig.baseUrl.includes("openrouter.ai")) {
      defaultHeaders["HTTP-Referer"] = "https://revvie.xride-labs.in";
      defaultHeaders["X-Title"] = "Revvie AI";
    }

    clientInstance = new OpenAI({
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
      defaultHeaders: Object.keys(defaultHeaders).length ? defaultHeaders : undefined,
    });
  }
  return clientInstance;
}
