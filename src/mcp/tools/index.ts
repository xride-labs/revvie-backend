import { createRideTool, searchRidesTool } from "./ride.tools.js";
import { getMyProfileTool, getMyGarageTool } from "./user.tools.js";
import { searchBikeSpecsTool } from "./bike.tools.js";
import { McpToolDefinition } from "../types.js";

export const allMcpTools: McpToolDefinition[] = [
  createRideTool,
  searchRidesTool,
  getMyProfileTool,
  getMyGarageTool,
  searchBikeSpecsTool,
];

export * from "./ride.tools.js";
export * from "./user.tools.js";
export * from "./bike.tools.js";
export * from "../types.js";
