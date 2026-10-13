import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRevvieMcpServer } from "./server.js";

async function run() {
  const userId = process.env.MCP_SERVICE_USER_ID;
  if (!userId) {
    throw new Error("Set MCP_SERVICE_USER_ID to the user the MCP tools should act as.");
  }
  const systemContext = { userId };

  const server = createRevvieMcpServer(systemContext);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("Revvie MCP Server running on stdio");
}

run().catch((err) => {
  console.error("Fatal error in MCP stdio server:", err);
  process.exit(1);
});
