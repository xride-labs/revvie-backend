/**
 * trigger_emergency / emergency-alert — "rider pinging for assistance".
 *
 * Covers the authorization fix found in review: the handler previously
 * broadcast an SOS and pushed real ride participants for ANY authenticated
 * caller passing an arbitrary rideId, with no check that the sender was
 * actually on that ride.
 */

import {
  createTestUser,
  createTestRide,
  addRideParticipant,
  cleanupTestData,
} from "../../test/utils";
import {
  startSocketTestServer,
  stopSocketTestServer,
  connectTestSocket,
  waitForEvent,
  emitWithAck,
} from "../../test/socketTestServer";
import prisma from "../../lib/prisma";

describe("trigger_emergency (SOS)", () => {
  beforeAll(async () => {
    await startSocketTestServer();
  });

  afterAll(async () => {
    await stopSocketTestServer();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it("broadcasts to the ride room and persists a notification for every other participant", async () => {
    const creator = await createTestUser();
    const rider = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const riderSocket = await connectTestSocket(rider.token);

    try {
      await emitWithAck(creatorSocket, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(riderSocket, "join_ride_tracking", { rideId: ride.id });

      const alertPromise = waitForEvent<any>(riderSocket, "emergency_alert");
      const ack = await emitWithAck<{ success: boolean }>(creatorSocket, "trigger_emergency", {
        rideId: ride.id,
        latitude: 12.9,
        longitude: 77.6,
        message: "Went down on a corner",
      });
      expect(ack.success).toBe(true);

      const alert = await alertPromise;
      expect(alert.userId).toBe(creator.user.id);
      expect(alert.message).toBe("Went down on a corner");

      // Notification persisted for the OTHER participant (rider), not the
      // sender — "sender already knows they triggered SOS".
      await new Promise((resolve) => setTimeout(resolve, 200)); // post-ack async DB work
      const notifications = await prisma.notification.findMany({
        where: { userId: rider.user.id, relatedId: ride.id },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe("SOS_ALERT");
    } finally {
      creatorSocket.disconnect();
      riderSocket.disconnect();
    }
  });

  it("rejects an SOS from someone who isn't actually on the ride", async () => {
    const creator = await createTestUser();
    const rider = await createTestUser();
    const outsider = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

    const outsiderSocket = await connectTestSocket(outsider.token);
    const riderSocket = await connectTestSocket(rider.token);

    try {
      await emitWithAck(riderSocket, "join_ride_tracking", { rideId: ride.id });

      let receivedAlert = false;
      riderSocket.once("emergency_alert", () => {
        receivedAlert = true;
      });

      const ack = await emitWithAck<{ success: boolean; error?: string }>(
        outsiderSocket,
        "trigger_emergency",
        { rideId: ride.id, latitude: 1, longitude: 1, message: "fabricated SOS" },
      );
      expect(ack.success).toBe(false);

      // Give a real broadcast a moment to arrive if the check had failed open.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(receivedAlert).toBe(false);

      const notifications = await prisma.notification.findMany({
        where: { userId: rider.user.id, relatedId: ride.id },
      });
      expect(notifications).toHaveLength(0);
    } finally {
      outsiderSocket.disconnect();
      riderSocket.disconnect();
    }
  });
});
