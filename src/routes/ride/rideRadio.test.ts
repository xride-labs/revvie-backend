/**
 * Group radio (socket.ts: radio:start / radio:audio / radio:cancel) — the
 * half-duplex push-to-talk broadcast that closes the "radio calls are
 * strictly 1:1" gap the club-ride simulation surfaced. One rider holds the
 * channel at a time; everyone else in the ride room hears the finished clip.
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

describe("Group radio (push-to-talk broadcast)", () => {
  beforeAll(async () => {
    await startSocketTestServer();
  });

  afterAll(async () => {
    await stopSocketTestServer();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it("grants the channel to the first rider, notifies the room, and blocks a second rider until it's released", async () => {
    const creator = await createTestUser();
    const speaker = await createTestUser();
    const blocked = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(speaker.user.id, ride.id, "ACCEPTED");
    await addRideParticipant(blocked.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const speakerSocket = await connectTestSocket(speaker.token);
    const blockedSocket = await connectTestSocket(blocked.token);

    try {
      await Promise.all(
        [creatorSocket, speakerSocket, blockedSocket].map((s) =>
          emitWithAck(s, "join_ride_tracking", { rideId: ride.id }),
        ),
      );

      const startedPromise = waitForEvent<any>(creatorSocket, "radio:transmission_started");
      const startAck = await emitWithAck<{ success: boolean }>(speakerSocket, "radio:start", {
        rideId: ride.id,
      });
      expect(startAck.success).toBe(true);
      const started = await startedPromise;
      expect(started.userId).toBe(speaker.user.id);

      const busyAck = await emitWithAck<{ success: boolean; code?: string; busyUserId?: string }>(
        blockedSocket,
        "radio:start",
        { rideId: ride.id },
      );
      expect(busyAck.success).toBe(false);
      expect(busyAck.code).toBe("CHANNEL_BUSY");
      expect(busyAck.busyUserId).toBe(speaker.user.id);
    } finally {
      [creatorSocket, speakerSocket, blockedSocket].forEach((s) => s.disconnect());
    }
  });

  it("relays the finished clip to the room, releases the channel, and lets the next rider talk", async () => {
    const creator = await createTestUser();
    const speaker = await createTestUser();
    const next = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(speaker.user.id, ride.id, "ACCEPTED");
    await addRideParticipant(next.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const speakerSocket = await connectTestSocket(speaker.token);
    const nextSocket = await connectTestSocket(next.token);

    try {
      await Promise.all(
        [creatorSocket, speakerSocket, nextSocket].map((s) =>
          emitWithAck(s, "join_ride_tracking", { rideId: ride.id }),
        ),
      );

      await emitWithAck(speakerSocket, "radio:start", { rideId: ride.id });

      const clipPromise = waitForEvent<any>(creatorSocket, "radio:transmission");
      const endedPromise = waitForEvent<any>(creatorSocket, "radio:transmission_ended");
      const fakeClip = Buffer.from("fake-aac-audio-bytes").toString("base64");
      const audioAck = await emitWithAck<{ success: boolean }>(speakerSocket, "radio:audio", {
        rideId: ride.id,
        audio: fakeClip,
        durationMs: 2500,
      });
      expect(audioAck.success).toBe(true);

      const clip = await clipPromise;
      expect(clip.userId).toBe(speaker.user.id);
      expect(clip.audio).toBe(fakeClip);
      expect(clip.durationMs).toBe(2500);

      const ended = await endedPromise;
      expect(ended.userId).toBe(speaker.user.id);

      // Speaker doesn't hear their own clip echoed back.
      let speakerHeardOwnClip = false;
      speakerSocket.once("radio:transmission", () => { speakerHeardOwnClip = true; });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(speakerHeardOwnClip).toBe(false);

      // Channel is free again.
      const nextStartAck = await emitWithAck<{ success: boolean }>(nextSocket, "radio:start", {
        rideId: ride.id,
      });
      expect(nextStartAck.success).toBe(true);
    } finally {
      [creatorSocket, speakerSocket, nextSocket].forEach((s) => s.disconnect());
    }
  });

  it("rejects radio:audio from someone who doesn't currently hold the channel", async () => {
    const creator = await createTestUser();
    const impersonator = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(impersonator.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const impersonatorSocket = await connectTestSocket(impersonator.token);

    try {
      await emitWithAck(creatorSocket, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(impersonatorSocket, "join_ride_tracking", { rideId: ride.id });

      const ack = await emitWithAck<{ success: boolean }>(impersonatorSocket, "radio:audio", {
        rideId: ride.id,
        audio: Buffer.from("x").toString("base64"),
      });
      expect(ack.success).toBe(false);
    } finally {
      creatorSocket.disconnect();
      impersonatorSocket.disconnect();
    }
  });

  it("cancel releases the channel without broadcasting a transmission", async () => {
    const creator = await createTestUser();
    const speaker = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(speaker.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const speakerSocket = await connectTestSocket(speaker.token);

    try {
      await emitWithAck(creatorSocket, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(speakerSocket, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(speakerSocket, "radio:start", { rideId: ride.id });

      let sawClip = false;
      creatorSocket.once("radio:transmission", () => { sawClip = true; });
      const endedPromise = waitForEvent<any>(creatorSocket, "radio:transmission_ended");

      await emitWithAck(speakerSocket, "radio:cancel", { rideId: ride.id });
      await endedPromise;
      expect(sawClip).toBe(false);

      const nextAck = await emitWithAck<{ success: boolean }>(creatorSocket, "radio:start", {
        rideId: ride.id,
      });
      expect(nextAck.success).toBe(true);
    } finally {
      creatorSocket.disconnect();
      speakerSocket.disconnect();
    }
  });

  it("releases the channel automatically when the holder disconnects mid-transmission", async () => {
    const creator = await createTestUser();
    const speaker = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(speaker.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const speakerSocket = await connectTestSocket(speaker.token);

    try {
      await emitWithAck(creatorSocket, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(speakerSocket, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(speakerSocket, "radio:start", { rideId: ride.id });

      const endedPromise = waitForEvent<any>(creatorSocket, "radio:transmission_ended");
      speakerSocket.disconnect();
      const ended = await endedPromise;
      expect(ended.userId).toBe(speaker.user.id);
    } finally {
      creatorSocket.disconnect();
    }
  });

  it("rejects radio:start from someone who isn't actually on the ride", async () => {
    const creator = await createTestUser();
    const outsider = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });

    const outsiderSocket = await connectTestSocket(outsider.token);
    try {
      const ack = await emitWithAck<{ success: boolean }>(outsiderSocket, "radio:start", {
        rideId: ride.id,
      });
      expect(ack.success).toBe(false);
    } finally {
      outsiderSocket.disconnect();
    }
  });
});
