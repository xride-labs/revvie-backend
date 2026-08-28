-- Group Ride Report: per-ride tallies of safety/cohesion signals, snapshotted
-- onto ride_summaries at end-of-ride (see RideEventCounters in socket.ts).
ALTER TABLE "ride_summaries" ADD COLUMN "sos_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ride_summaries" ADD COLUMN "falling_behind_events" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ride_summaries" ADD COLUMN "unresponsive_events" INTEGER NOT NULL DEFAULT 0;
