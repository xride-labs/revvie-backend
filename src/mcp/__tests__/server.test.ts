import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRevvieMcpServer } from "../server.js";
import { prisma } from "../../lib/prisma.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    ride: { findMany: vi.fn(), create: vi.fn() },
    bike: { findMany: vi.fn() },
    bikeModel: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

async function connect(userId = "rider-1") {
  const server = createRevvieMcpServer({ userId });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("MCP server over the protocol", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists every Revvie tool", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_ride",
      "get_my_garage",
      "get_my_profile",
      "search_bike_specs",
      "search_rides",
    ]);
  });

  it("only searches public rides and the caller's own", async () => {
    (prisma.ride.findMany as any).mockResolvedValue([]);
    const client = await connect("rider-1");
    await client.callTool({ name: "search_rides", arguments: { query: "Nandi" } });
    const where = (prisma.ride.findMany as any).mock.calls[0][0].where;
    expect(where.OR).toEqual([{ privacyLevel: "PUBLIC" }, { creatorId: "rider-1" }]);
  });

  it("creates rides as the session user, ignoring any creator the model supplies", async () => {
    (prisma.ride.create as any).mockResolvedValue({
      id: "r1", title: "T", startLocation: "A", endLocation: null, scheduledAt: new Date(), status: "PLANNED",
    });
    const client = await connect("rider-1");
    await client.callTool({ name: "create_ride", arguments: { title: "T", startLocation: "A", creatorId: "someone-else" } });
    expect((prisma.ride.create as any).mock.calls[0][0].data.creatorId).toBe("rider-1");
  });

  it("returns the caller's garage from the bikes table", async () => {
    (prisma.bike.findMany as any).mockResolvedValue([
      { id: "b1", nickname: "Hima", make: "Royal Enfield", model: "Himalayan 450", year: 2024, engineCc: 452, isPrimary: true, bikeModel: null },
    ]);
    const client = await connect("rider-1");
    const res: any = await client.callTool({ name: "get_my_garage", arguments: {} });
    expect((prisma.bike.findMany as any).mock.calls[0][0].where).toEqual({ userId: "rider-1" });
    expect(JSON.parse(res.content[0].text).bikes[0].model).toBe("Himalayan 450");
  });

  it("surfaces tool failures as MCP errors instead of throwing", async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);
    const client = await connect();
    const res: any = await client.callTool({ name: "get_my_profile", arguments: {} });
    expect(res.isError).toBe(true);
  });
});
