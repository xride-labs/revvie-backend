import { z } from "zod";

export interface ToolContext {
  userId: string;
  userRole?: string;
}

export interface McpToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: T;
  handler: (args: z.infer<T>, context: ToolContext) => Promise<any>;
}
