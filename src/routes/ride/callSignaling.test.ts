/**
 * P2P CALL SIGNALING (custom WebRTC) — call:invite / call:respond /
 * call:signal / call:end, plus busy/offline rejection and disconnect
 * cleanup. This channel only relays messages; there's no media here to
 * test, just the signaling state machine.
 */

import { createTestUser, createTestRide, addRideParticipant, cleanupTestData } from "../../test/utils";
import {
  startSocketTestServer,
  stopSocketTestServer,
  connectTestSocket,
  waitForEvent,
  emitWithAck,
} from "../../test/socketTestServer";
import type { Socket as ClientSocket } from "socket.io-client";

describe("P2P call signaling", () => {
  beforeAll(async () => {
    await startSocketTestServer();
  });

  afterAll(async () => {
    await stopSocketTestServer();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it("rings the callee, relays accept, and relays a signal message both ways", async () => {
    const caller = await createTestUser();
    const callee = await createTestUser();
    const ride = await createTestRide(caller.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(callee.user.id, ride.id, "ACCEPTED");

    const callerSocket = await connectTestSocket(caller.token);
    const calleeSocket = await connectTestSocket(callee.token);

    try {
      const incomingPromise = waitForEvent<any>(calleeSocket, "call:incoming");
      const inviteAck = await emitWithAck<{ success: boolean; callId: string }>(
        callerSocket,
        "call:invite",
        { toUserId: callee.user.id, rideId: ride.id },
      );
      expect(inviteAck.success).toBe(true);
      expect(inviteAck.callId).toBeTruthy();

      const incoming = await incomingPromise;
      expect(incoming.callId).toBe(inviteAck.callId);
      expect(incoming.fromUserId).toBe(caller.user.id);

      const respondedPromise = waitForEvent<any>(callerSocket, "call:responded");
      await emitWithAck(calleeSocket, "call:respond", { callId: incoming.callId, accepted: true });
      const responded = await respondedPromise;
      expect(responded.accepted).toBe(true);

      // Simulate an SDP offer from caller -> callee via the generic relay.
      const signalPromise = waitForEvent<any>(calleeSocket, "call:signal");
      await emitWithAck(callerSocket, "call:signal", {
        callId: incoming.callId,
        data: { type: "offer", sdp: "v=0..." },
      });
      const signal = await signalPromise;
      expect(signal.fromUserId).toBe(caller.user.id);
      expect(signal.data.type).toBe("offer");

      const endedPromise = waitForEvent<any>(calleeSocket, "call:ended");
      await emitWithAck(callerSocket, "call:end", { callId: incoming.callId });
      const ended = await endedPromise;
      expect(ended.reason).toBe("ended");
    } finally {
      callerSocket.disconnect();
      calleeSocket.disconnect();
    }
  });

  it("relays a decline instead of establishing a call", async () => {
    const caller = await createTestUser();
    const callee = await createTestUser();
    const ride = await createTestRide(caller.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(callee.user.id, ride.id, "ACCEPTED");

    const callerSocket = await connectTestSocket(caller.token);
    const calleeSocket = await connectTestSocket(callee.token);

    try {
      const incomingPromise = waitForEvent<any>(calleeSocket, "call:incoming");
      const { callId } = await emitWithAck<{ callId: string }>(callerSocket, "call:invite", {
        toUserId: callee.user.id,
        rideId: ride.id,
      });
      await incomingPromise;

      const respondedPromise = waitForEvent<any>(callerSocket, "call:responded");
      await emitWithAck(calleeSocket, "call:respond", { callId, accepted: false });
      const responded = await respondedPromise;
      expect(responded.accepted).toBe(false);

      // Rejected call is gone server-side — a signal against it should fail.
      const signalAck = await emitWithAck<{ success: boolean }>(callerSocket, "call:signal", {
        callId,
        data: {},
      });
      expect(signalAck.success).toBe(false);
    } finally {
      callerSocket.disconnect();
      calleeSocket.disconnect();
    }
  });

  it("rejects a second invite while the callee is already ringing/active", async () => {
    const caller = await createTestUser();
    const callee = await createTestUser();
    const thirdParty = await createTestUser();
    const ride = await createTestRide(caller.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(callee.user.id, ride.id, "ACCEPTED");
    await addRideParticipant(thirdParty.user.id, ride.id, "ACCEPTED");

    const callerSocket = await connectTestSocket(caller.token);
    const calleeSocket = await connectTestSocket(callee.token);
    const thirdSocket = await connectTestSocket(thirdParty.token);

    try {
      await emitWithAck(callerSocket, "call:invite", { toUserId: callee.user.id, rideId: ride.id });

      const secondAck = await emitWithAck<{ success: boolean; code?: string }>(
        thirdSocket,
        "call:invite",
        { toUserId: callee.user.id, rideId: ride.id },
      );
      expect(secondAck.success).toBe(false);
      expect(secondAck.code).toBe("CALLEE_BUSY");
    } finally {
      callerSocket.disconnect();
      calleeSocket.disconnect();
      thirdSocket.disconnect();
    }
  });

  it("rejects inviting an offline user", async () => {
    const caller = await createTestUser();
    const offlineUser = await createTestUser();
    const ride = await createTestRide(caller.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(offlineUser.user.id, ride.id, "ACCEPTED");

    const callerSocket = await connectTestSocket(caller.token);
    try {
      const ack = await emitWithAck<{ success: boolean; code?: string }>(callerSocket, "call:invite", {
        toUserId: offlineUser.user.id,
        rideId: ride.id,
      });
      expect(ack.success).toBe(false);
      expect(ack.code).toBe("CALLEE_OFFLINE");
    } finally {
      callerSocket.disconnect();
    }
  });

  it("notifies the peer and clears call state when a party disconnects mid-call", async () => {
    const caller = await createTestUser();
    const callee = await createTestUser();
    const ride = await createTestRide(caller.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(callee.user.id, ride.id, "ACCEPTED");

    const callerSocket = await connectTestSocket(caller.token);
    const calleeSocket = await connectTestSocket(callee.token);

    const incomingPromise = waitForEvent<any>(calleeSocket, "call:incoming");
    const { callId } = await emitWithAck<{ callId: string }>(callerSocket, "call:invite", {
      toUserId: callee.user.id,
      rideId: ride.id,
    });
    await incomingPromise;
    await emitWithAck(calleeSocket, "call:respond", { callId, accepted: true });

    const endedPromise = waitForEvent<any>(calleeSocket, "call:ended");
    callerSocket.disconnect();
    const ended = await endedPromise;
    expect(ended.reason).toBe("peer_disconnected");

    // State is fully cleared — the callee can now be invited into a new call.
    const thirdParty = await createTestUser();
    await addRideParticipant(thirdParty.user.id, ride.id, "ACCEPTED");
    const thirdSocket: ClientSocket = await connectTestSocket(thirdParty.token);
    try {
      const ack = await emitWithAck<{ success: boolean }>(thirdSocket, "call:invite", {
        toUserId: callee.user.id,
        rideId: ride.id,
      });
      expect(ack.success).toBe(true);
    } finally {
      thirdSocket.disconnect();
      calleeSocket.disconnect();
    }
  });

  it("rejects a call scoped to a ride neither party is actually on", async () => {
    const caller = await createTestUser();
    const callee = await createTestUser();
    // Both online and both real users — but not participants of this ride.
    const ride = await createTestRide((await createTestUser()).user.id, { status: "IN_PROGRESS" });

    const callerSocket = await connectTestSocket(caller.token);
    const calleeSocket = await connectTestSocket(callee.token);

    try {
      let receivedIncoming = false;
      calleeSocket.once("call:incoming", () => {
        receivedIncoming = true;
      });

      const ack = await emitWithAck<{ success: boolean }>(callerSocket, "call:invite", {
        toUserId: callee.user.id,
        rideId: ride.id,
      });
      expect(ack.success).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(receivedIncoming).toBe(false);
    } finally {
      callerSocket.disconnect();
      calleeSocket.disconnect();
    }
  });
});
