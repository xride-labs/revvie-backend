import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { allMcpTools } from "./tools/index.js";
import { ToolContext } from "./types.js";

export function createRevvieMcpServer(context: ToolContext) {
  const server = new McpServer({
    name: "revvie-mcp-server",
    version: "1.0.0",
  });

  for (const toolDef of allMcpTools) {
    server.tool(
      toolDef.name,
      toolDef.description,
      (toolDef.schema as any).shape || {},
      async (args: any) => {
        try {
          const result = await toolDef.handler(args, context);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Error executing ${toolDef.name}: ${error.message || "Unknown error"}`,
              },
            ],
          };
        }
      }
    );
  }

  return server;
}
