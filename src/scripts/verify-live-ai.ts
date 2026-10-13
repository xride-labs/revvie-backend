import { prisma } from "../lib/prisma.js";
import { runAgentTurn } from "../ai/agent.js";
import { checkAndConsumeCredit, getRemainingCredits } from "../ai/credits.service.js";

async function main() {
  console.log("=== 1. Checking Database Connectivity ===");
  // Find or create test user
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "rider_ai_test@revvie.com",
        username: "rider_ai_test",
        name: "Test Rider AI",
      },
    });
  }
  console.log(`Using rider: ${user.name} (${user.id})`);

  console.log("\n=== 2. Testing AI Daily Credit System with Live Redis ===");
  const beforeCredits = await getRemainingCredits(user.id);
  console.log("Credits before call:", beforeCredits);

  const consumed = await checkAndConsumeCredit(user.id);
  console.log("Credit consumed status:", consumed);

  const afterCredits = await getRemainingCredits(user.id);
  console.log("Credits after call:", afterCredits);

  console.log("\n=== 3. Testing Live OpenRouter Tool Calling ===");
  console.log("Prompt: 'Create a scenic Sunday breakfast ride from Indiranagar to Nandi Hills at 6:00 AM'");

  const result = await runAgentTurn(
    "Create a scenic Sunday breakfast ride from Indiranagar to Nandi Hills at 6:00 AM",
    { userId: user.id }
  );

  console.log("\nAgent Response:");
  console.log(result.reply);

  console.log("\nTool Calls Executed:");
  console.log(JSON.stringify(result.toolCallsExecuted, null, 2));

  if (result.toolCallsExecuted.length > 0) {
    const rideCreated = result.toolCallsExecuted.find((t) => t.tool === "create_ride");
    if (rideCreated && rideCreated.result?.rideId) {
      console.log("\n=== 4. Verifying Created Ride in PostgreSQL ===");
      const savedRide = await prisma.ride.findUnique({
        where: { id: rideCreated.result.rideId },
      });
      console.log("Saved Ride in DB:", {
        id: savedRide?.id,
        title: savedRide?.title,
        startLocation: savedRide?.startLocation,
        endLocation: savedRide?.endLocation,
        scheduledAt: savedRide?.scheduledAt,
        status: savedRide?.status,
        creatorId: savedRide?.creatorId,
      });
    }
  }

  console.log("\n=== Live Test Complete ===");
  process.exit(0);
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
