import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "../agent.js";
import { prisma } from "../../lib/prisma.js";

const mockChatCreate = vi.fn();

vi.mock("../client.js", () => ({
  getAiClient: () => ({
    chat: {
      completions: {
        create: mockChatCreate,
      },
    },
  }),
}));

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    ride: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  },
}));

describe("End-to-End Conversational Tool Execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes create_ride tool and synthesizes confirmation", async () => {
    mockChatCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "create_ride",
                    arguments: JSON.stringify({
                      title: "Weekend Ooty Ride",
                      startLocation: "Bangalore",
                      endLocation: "Ooty",
                    }),
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "I have scheduled your Weekend Ooty Ride from Bangalore to Ooty!",
            },
          },
        ],
      });

    (prisma.ride.create as any).mockResolvedValue({
      id: "ride-ooty-101",
      title: "Weekend Ooty Ride",
      startLocation: "Bangalore",
      endLocation: "Ooty",
      scheduledAt: new Date(),
      status: "PLANNED",
    });

    const result = await runAgentTurn(
      "Plan a weekend ride to Ooty starting from Bangalore",
      { userId: "rider-test-id" }
    );

    expect(result.reply).toContain("Weekend Ooty Ride");
    expect(result.toolCallsExecuted).toHaveLength(1);
    expect(result.toolCallsExecuted[0].tool).toBe("create_ride");
    expect(result.toolCallsExecuted[0].result.rideId).toBe("ride-ooty-101");
  });
});
