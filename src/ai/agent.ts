import { z } from "zod";
import { getAiClient } from "./client.js";
import { buildSystemPrompt, formatUserMessage } from "./prompts.js";
import { allMcpTools } from "../mcp/tools/index.js";
import { ToolContext } from "../mcp/types.js";
import { aiConfig } from "../config/ai.config.js";

export function sanitizeUserPrompt(input: string): string {
  if (!input) return "";
  let cleaned = input
    .replace(/<\/?user_instruction>/gi, "")
    .replace(/<\/?system>/gi, "")
    .trim();
  if (cleaned.length > 2000) {
    cleaned = cleaned.slice(0, 2000);
  }
  return cleaned;
}

// History comes from the client, so only plain user/assistant text is accepted.
// Client-supplied system or tool turns would let a caller forge instructions or
// tool results.
export function sanitizeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (m): m is ChatMessage =>
        !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    )
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface AgentResult {
  reply: string;
  toolCallsExecuted: Array<{ tool: string; args: any; result: any }>;
}

export async function runAgentTurn(
  userPrompt: string,
  context: ToolContext,
  history: ChatMessage[] = []
): Promise<AgentResult> {
  const sanitized = sanitizeUserPrompt(userPrompt);
  if (!sanitized) {
    return { reply: "Please enter a valid message.", toolCallsExecuted: [] };
  }

  const client = getAiClient();

  const openaiTools = allMcpTools.map((t) => {
    const { $schema: _omit, ...parameters } = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, any>;
    return {
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters },
    };
  });

  const systemPrompt = buildSystemPrompt({
    userId: context.userId,
    userRole: context.userRole,
  });

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...sanitizeHistory(history),
    { role: "user", content: formatUserMessage(sanitized) },
  ];

  const toolCallsExecuted: Array<{ tool: string; args: any; result: any }> = [];
  let maxTurns = 5;

  while (maxTurns > 0) {
    maxTurns--;

    const response = await client.chat.completions.create({
      model: aiConfig.model,
      messages,
      tools: openaiTools.length ? openaiTools : undefined,
      tool_choice: "auto",
      temperature: aiConfig.temperature,
      max_tokens: aiConfig.maxTokens,
    });

    const choice = response.choices[0];
    const message = choice.message;

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return {
        reply: message.content || "Done!",
        toolCallsExecuted,
      };
    }

    // Process tool calls
    messages.push({
      role: "assistant",
      content: message.content || "",
      tool_calls: message.tool_calls,
    });

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;
      const toolDef = allMcpTools.find((t) => t.name === toolCall.function.name);
      let parsedArgs: any = {};
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch (e) {
        parsedArgs = {};
      }

      let toolOutput = "";
      if (toolDef) {
        try {
          const parsed = toolDef.schema.safeParse(parsedArgs);
          if (!parsed.success) {
            throw new Error(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
          }
          const result = await toolDef.handler(parsed.data, context);
          toolCallsExecuted.push({ tool: toolDef.name, args: parsedArgs, result });
          toolOutput = JSON.stringify(result);
        } catch (err: any) {
          toolOutput = JSON.stringify({ error: err.message || "Failed to execute tool" });
        }
      } else {
        toolOutput = JSON.stringify({ error: `Tool ${toolCall.function.name} not found` });
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolOutput,
      });
    }
  }

  return {
    reply: "I completed the requested actions.",
    toolCallsExecuted,
  };
}
