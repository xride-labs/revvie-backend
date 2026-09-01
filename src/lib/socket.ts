import { Server as HttpServer } from "http";
import { randomUUID } from "node:crypto";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { auth } from "../config/auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { ChatService } from "../services/chat.service.js";
import { LocationService } from "../services/location/location.service.js";
import { LocationSettingsService } from "../services/location/settings.service.js";
import { MessageType } from "../models/chat.model.js";
import type { IAttachment } from "../models/chat.model.js";
import { sendPushToUsers, channelForType, categoryForType } from "./push.js";
import prisma from "./prisma.js";
import { NotificationType } from "@prisma/client";
import { haversineDistance } from "./utils/geo.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  userId: string;
  userName: string;
}

interface SendMessagePayload {
  conversationId: string;
  text?: string;
  messageType?: string;
  attachments?: IAttachment[];
  location?: {
    latitude: number;
    longitude: number;
    label?: string;
    address?: string;
  };
  replyTo?: string;
}

interface TypingPayload {
  conversationId: string;
}

interface MarkReadPayload {
  conversationId: string;
}

interface JoinConversationPayload {
  conversationId: string;
}

interface LocationUpdatePayload {
  latitude: number;
  longitude: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  battery?: number;
  isMoving?: boolean;
  isOnRide?: boolean;
  rideId?: string;
}

interface JoinRidePayload {
  rideId: string;
  userId?: string;
}

// ── Track online users (in-memory; Redis-backed in production) ────────────
const onlineUsers = new Map<string, Set<string>>(); // userId → Set<socketId>
// Track users subscribed to location updates
const locationSubscribers = new Map<string, Set<string>>(); // rideId → Set<socketId>

// Track which conversations each user has open right now. Used to suppress
// push notifications for chat messages they are actively reading — Mirrors
// WhatsApp's "you don't get a banner for the chat you're in" behaviour.
const activeChatPresence = new Map<string, Set<string>>(); // conversationId → Set<userId>

function addActiveChat(conversationId: string, userId: string) {
  if (!activeChatPresence.has(conversationId)) {
    activeChatPresence.set(conversationId, new Set());
  }
  activeChatPresence.get(conversationId)!.add(userId);
}

function removeActiveChat(conversationId: string, userId: string) {
  const set = activeChatPresence.get(conversationId);
  if (!set) return;
  set.delete(userId);
  if (set.size === 0) activeChatPresence.delete(conversationId);
}

export function isUserActiveInChat(
  conversationId: string,
  userId: string,
): boolean {
  return activeChatPresence.get(conversationId)?.has(userId) ?? false;
}

// ── Rider location cache for late joiners ─────────────────────────────────
// Stores the last-known location for every rider currently in a live ride.
// Used to seed new joiners immediately without waiting for the next broadcast.
// In single-instance dev this in-memory map is the source of truth.
// When REDIS_URL is set, the Redis hash `ride:{id}:riders` is kept in sync
// and takes precedence so all server instances share the same state.
interface CachedRiderLocation {
  userId: string;
  name: string;
  avatar?: string | null;
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  isMoving: boolean;
  updatedAt: string;
}
const rideRiderCache = new Map<string, Map<string, CachedRiderLocation>>();
// Redis client reused from the adapter setup (null when REDIS_URL is absent)
let redisCacheClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  return redisCacheClient;
}

async function cacheRiderLocation(
  rideId: string,
  userId: string,
  payload: CachedRiderLocation,
) {
  if (redisCacheClient) {
    try {
      await redisCacheClient.hset(
        `ride:${rideId}:riders`,
        userId,
        JSON.stringify(payload),
      );
      await redisCacheClient.expire(`ride:${rideId}:riders`, 3600);
    } catch {
      // Redis write failure — in-memory cache is still updated below
    }
  }
  if (!rideRiderCache.has(rideId)) rideRiderCache.set(rideId, new Map());
  rideRiderCache.get(rideId)!.set(userId, payload);
}

async function getCachedRiders(rideId: string): Promise<CachedRiderLocation[]> {
  if (redisCacheClient) {
    try {
      const data = await redisCacheClient.hgetall(`ride:${rideId}:riders`);
      if (data && Object.keys(data).length > 0) {
        return Object.values(data).map(
          (v) => JSON.parse(v) as CachedRiderLocation,
        );
      }
    } catch {
      // Redis read failure — fall through to in-memory
      console.warn(
        `[SOCKET] Failed to read rider cache from Redis for ride ${rideId}`,
      );
    }
  }
  const cache = rideRiderCache.get(rideId);
  if (!cache) return [];
  return Array.from(cache.values());
}

async function removeCachedRider(rideId: string, userId: string) {
  // In-memory cache is updated synchronously either way; the Redis delete
  // is awaited (not fire-and-forget) so a caller that notifies other
  // clients right after this resolves can't race a late joiner's
  // getCachedRiders() read against a still-in-flight HDEL — that gap
  // previously let a just-disconnected rider briefly reappear in a late
  // joiner's cached snapshot.
  if (redisCacheClient) {
    await redisCacheClient.hdel(`ride:${rideId}:riders`, userId).catch(() => {});
  }
  rideRiderCache.get(rideId)?.delete(userId);
  clearHealthState(rideId, userId);
  regroupArrivals.get(rideId)?.delete(userId);
}

// Track which rides each socket is in so we can clean up on disconnect
const socketRides = new Map<string, Set<string>>(); // socketId → Set<rideId>

// ── P2P call state (custom WebRTC signaling — see the call: handlers below) ──
// Tracks both "ringing" (invite sent, not yet answered) and "active"
// (accepted) calls, keyed by each participant's userId so either side's
// disconnect can find and notify the other. A user can only be in one call
// entry at a time — a second invite while already ringing/active is
// rejected rather than silently overwritten.
interface ActiveCall {
  callId: string;
  peerId: string;
  rideId: string;
  status: "ringing" | "active";
}
const activeCallsByUser = new Map<string, ActiveCall>(); // userId → ActiveCall

function endCallForBothSides(userId: string): ActiveCall | undefined {
  const call = activeCallsByUser.get(userId);
  if (!call) return undefined;
  activeCallsByUser.delete(userId);
  activeCallsByUser.delete(call.peerId);
  return call;
}

// ── Group radio (half-duplex push-to-talk broadcast) ────────────────────────
// Distinct from the 1:1 P2P call signaling above: this is a many-listener
// broadcast of a short recorded voice clip to everyone in the ride room, like
// a real two-way radio, not a call. Only one rider can hold the channel at a
// time — enforced server-side via `radioBusyByRide` — and clips are relayed
// in-memory only, never persisted, matching how a real radio transmission
// isn't a permanent record the way a chat message is.
const MAX_RADIO_CLIP_BASE64_CHARS = 1_100_000; // ~800KB raw audio
const RADIO_MAX_HOLD_MS = 20_000; // safety backstop if a client never sends audio or cancels

interface RadioLock {
  userId: string;
  name: string;
  startedAt: number;
  safetyTimer: ReturnType<typeof setTimeout>;
}
const radioBusyByRide = new Map<string, RadioLock>();

/** Releases the channel and notifies the room. If `expectedUserId` is given, only releases when that user actually holds it (guards against a stale/late cancel racing a fresh start). */
function releaseRadioLock(rideId: string, expectedUserId?: string) {
  const lock = radioBusyByRide.get(rideId);
  if (!lock) return;
  if (expectedUserId && lock.userId !== expectedUserId) return;
  clearTimeout(lock.safetyTimer);
  radioBusyByRide.delete(rideId);
  ioInstance?.to(`ride:${rideId}`).emit("radio:transmission_ended", { userId: lock.userId });
}

// ── Completed-ride tombstones ──────────────────────────────────────────────
// When a ride ends we add it here for ~30min. Late `update_location` packets
// from clients that haven't received the `ride-completed` event yet are
// rejected without broadcasting, so the live screen can't keep updating
// after the ride is officially done.
const completedRideIds = new Map<string, number>(); // rideId → expiry epoch ms
const COMPLETED_RIDE_TOMBSTONE_MS = 30 * 60_000;

function isRideCompleted(rideId: string): boolean {
  const exp = completedRideIds.get(rideId);
  if (!exp) return false;
  if (exp < Date.now()) {
    completedRideIds.delete(rideId);
    return false;
  }
  return true;
}

// ── Group cohesion + rider-health detection ─────────────────────────────────
// Two distinct "something's wrong with a rider" signals a group ride needs
// that individual solo tracking never had to worry about:
//
//   1. "Falling behind" — a rider has drifted far from the rest of the group.
//      Reference point is the centroid of every OTHER currently-tracked
//      rider's last-known position (not the lead specifically — a lead is
//      optional, and in practice a scattered group's "center of mass" is a
//      more honest signal than distance-to-one-person).
//   2. "Unresponsive" — a rider's socket is still connected (a hard
//      disconnect is handled immediately below, in the `disconnect` handler)
//      but no location fix has arrived in a while: GPS stalled, the app
//      froze, or the phone locked without background-location permission.
//
// Both use hysteresis (a higher ENTER threshold than EXIT/recovery) and a
// sustained-duration requirement before firing, so a single noisy GPS fix or
// a momentary radio dead-zone doesn't spam the group with false alarms.
const FALLING_BEHIND_ENTER_M = 2000;
const FALLING_BEHIND_EXIT_M = 1200;
// Real Date.now()-driven timers, same as completedRideIds' tombstone TTL
// elsewhere in this file — production values would make an integration test
// wait 45+ real seconds per case, so (mirroring the NODE_ENV==="test" gate
// server.ts already uses to skip starting a live server in tests) the sweep
// runs fast and the sustained/staleness windows shrink to milliseconds.
const IS_TEST = process.env.NODE_ENV === "test";
const FALLING_BEHIND_SUSTAINED_MS = IS_TEST ? 150 : 45_000;
const UNRESPONSIVE_THRESHOLD_MS = IS_TEST ? 150 : 45_000;
const UNRESPONSIVE_SWEEP_INTERVAL_MS = IS_TEST ? 40 : 15_000;
// A rider whose last fix is older than this is treated as "not really here"
// for centroid purposes — otherwise a ghost/stale cache entry could drag the
// group's reference point toward a position nobody is actually near anymore.
const CENTROID_STALE_CUTOFF_MS = 120_000;

interface RiderHealthState {
  fallingBehindSince: number | null;
  flaggedFallingBehind: boolean;
  flaggedUnresponsive: boolean;
}
const rideRiderHealth = new Map<string, Map<string, RiderHealthState>>();

function getHealthState(rideId: string, userId: string): RiderHealthState {
  if (!rideRiderHealth.has(rideId)) rideRiderHealth.set(rideId, new Map());
  const riders = rideRiderHealth.get(rideId)!;
  if (!riders.has(userId)) {
    riders.set(userId, {
      fallingBehindSince: null,
      flaggedFallingBehind: false,
      flaggedUnresponsive: false,
    });
  }
  return riders.get(userId)!;
}

function clearHealthState(rideId: string, userId: string) {
  rideRiderHealth.get(rideId)?.delete(userId);
}

function clearRideHealth(rideId: string) {
  rideRiderHealth.delete(rideId);
}

/**
 * Called right after a rider's position is cached. Reads directly from the
 * in-memory `rideRiderCache` (not `getCachedRiders`'s Redis-preferring path)
 * — this is a soft-realtime UX signal, not the authoritative late-joiner
 * snapshot, so the tiny staleness window on a multi-instance deployment
 * (a rider's latest ping landed on a different instance than the one running
 * this check) is an acceptable tradeoff for avoiding a Redis round-trip on
 * every single location tick.
 */
function evaluateGroupCohesion(
  rideId: string,
  userId: string,
  name: string,
  latitude: number,
  longitude: number,
) {
  const riders = rideRiderCache.get(rideId);
  if (!riders || riders.size < 2) return; // solo, or no one else cached yet

  const now = Date.now();
  let sumLat = 0;
  let sumLon = 0;
  let count = 0;
  for (const [otherId, cached] of riders) {
    if (otherId === userId) continue;
    if (now - Date.parse(cached.updatedAt) > CENTROID_STALE_CUTOFF_MS) continue;
    sumLat += cached.latitude;
    sumLon += cached.longitude;
    count++;
  }
  if (count === 0) return;

  const centroidLat = sumLat / count;
  const centroidLon = sumLon / count;
  const distanceM = haversineDistance(latitude, longitude, centroidLat, centroidLon) * 1000;

  const health = getHealthState(rideId, userId);
  if (distanceM >= FALLING_BEHIND_ENTER_M) {
    if (health.fallingBehindSince == null) health.fallingBehindSince = now;
    const sustainedMs = now - health.fallingBehindSince;
    if (!health.flaggedFallingBehind && sustainedMs >= FALLING_BEHIND_SUSTAINED_MS) {
      health.flaggedFallingBehind = true;
      bumpRideEventCounter(rideId, "fallingBehindEvents");
      ioInstance?.to(`ride:${rideId}`).emit("rider_falling_behind", {
        userId,
        name,
        distanceM: Math.round(distanceM),
        timestamp: new Date().toISOString(),
      });
    }
  } else if (distanceM <= FALLING_BEHIND_EXIT_M) {
    health.fallingBehindSince = null;
    if (health.flaggedFallingBehind) {
      health.flaggedFallingBehind = false;
      ioInstance?.to(`ride:${rideId}`).emit("rider_back_on_track", {
        userId,
        timestamp: new Date().toISOString(),
      });
    }
  }
  // Otherwise we're in the hysteresis band between EXIT and ENTER — leave
  // state as-is rather than flapping.
}

/**
 * Periodic sweep for riders who are still connected but have gone quiet.
 * Same in-memory-cache caveat as evaluateGroupCohesion above applies here —
 * a genuinely distributed deployment would need this sweep (and the cache it
 * reads) backed by Redis to catch a rider whose last ping landed on a
 * different instance.
 */
function sweepUnresponsiveRiders() {
  const now = Date.now();
  for (const [rideId, riders] of rideRiderCache) {
    for (const [userId, cached] of riders) {
      const health = getHealthState(rideId, userId);
      const staleMs = now - Date.parse(cached.updatedAt);
      if (staleMs >= UNRESPONSIVE_THRESHOLD_MS) {
        if (!health.flaggedUnresponsive) {
          health.flaggedUnresponsive = true;
          bumpRideEventCounter(rideId, "unresponsiveEvents");
          ioInstance?.to(`ride:${rideId}`).emit("rider_unresponsive", {
            userId,
            name: cached.name,
            lastSeenAt: cached.updatedAt,
          });
        }
      } else if (health.flaggedUnresponsive) {
        health.flaggedUnresponsive = false;
        ioInstance?.to(`ride:${rideId}`).emit("rider_responsive_again", {
          userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

// ── Post-ride group event counters ──────────────────────────────────────────
// Tallies how many times each signal fired over the life of a ride, so the
// post-ride summary can show a real "Group Ride Report" (SOS count, riders
// who fell behind, riders who went unresponsive) instead of that context
// being gone the moment the ride ends. Read once by the /:id/end route and
// cleared right after — see ride.routes.ts.
export interface RideEventCounters {
  fallingBehindEvents: number;
  unresponsiveEvents: number;
  sosCount: number;
}
const rideEventCounters = new Map<string, RideEventCounters>();

function bumpRideEventCounter(rideId: string, key: keyof RideEventCounters) {
  if (!rideEventCounters.has(rideId)) {
    rideEventCounters.set(rideId, { fallingBehindEvents: 0, unresponsiveEvents: 0, sosCount: 0 });
  }
  rideEventCounters.get(rideId)![key]++;
}

export function getRideEventCounters(rideId: string): RideEventCounters {
  return rideEventCounters.get(rideId) ?? { fallingBehindEvents: 0, unresponsiveEvents: 0, sosCount: 0 };
}

export function clearRideEventCounters(rideId: string): void {
  rideEventCounters.delete(rideId);
}

// ── Regroup point ────────────────────────────────────────────────────────
// The ride lead (or creator) can drop a "meet here" pin — a rest stop, a
// scenic overlook, a spot to wait for stragglers. The server tracks who's
// physically arrived (within REGROUP_ARRIVAL_RADIUS_M) so the group can see
// live progress ("3/8 arrived") instead of everyone asking in chat.
const REGROUP_ARRIVAL_RADIUS_M = 80;

interface RegroupPoint {
  latitude: number;
  longitude: number;
  label: string | null;
  setBy: string;
  setByName: string;
  setAt: string;
}
const regroupPointByRide = new Map<string, RegroupPoint>();
const regroupArrivals = new Map<string, Set<string>>();

function clearRegroupState(rideId: string) {
  regroupPointByRide.delete(rideId);
  regroupArrivals.delete(rideId);
}

/** Shared by regroup:set/clear and route:updated — both are "speak for the group" actions. */
async function isCreatorOrLead(rideId: string, userId: string): Promise<boolean> {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: { creatorId: true, leadUserId: true },
  });
  if (!ride) return false;
  return ride.creatorId === userId || ride.leadUserId === userId;
}

/** Called alongside evaluateGroupCohesion, right after a rider's position is cached. */
function evaluateRegroupArrival(
  rideId: string,
  userId: string,
  name: string,
  latitude: number,
  longitude: number,
) {
  const point = regroupPointByRide.get(rideId);
  if (!point) return;
  if (!regroupArrivals.has(rideId)) regroupArrivals.set(rideId, new Set());
  const arrivals = regroupArrivals.get(rideId)!;
  if (arrivals.has(userId)) return; // already counted

  const distanceM = haversineDistance(latitude, longitude, point.latitude, point.longitude) * 1000;
  if (distanceM > REGROUP_ARRIVAL_RADIUS_M) return;

  arrivals.add(userId);
  const totalExpected = rideRiderCache.get(rideId)?.size ?? 0;
  ioInstance?.to(`ride:${rideId}`).emit("regroup:rider_arrived", {
    userId,
    name,
    arrivedCount: arrivals.size,
    totalExpected,
    timestamp: new Date().toISOString(),
  });
  if (totalExpected > 0 && arrivals.size >= totalExpected) {
    ioInstance?.to(`ride:${rideId}`).emit("regroup:complete", {
      rideId,
      timestamp: new Date().toISOString(),
    });
  }
}

// ── Ride membership authorization ───────────────────────────────────────────
// join_ride_tracking / trigger_emergency / call:invite all need "is this user
// actually on this ride" before joining the room, broadcasting an SOS, or
// ringing someone — none of them checked this before (unlike the analogous
// join_conversation, which calls ChatService.isParticipant). Without it, any
// authenticated user who obtains a rideId (shared link, screenshot, guessed
// id) could join a stranger's ride room and read their live location, or
// spam a fabricated SOS to real participants.
async function isRideParticipant(
  rideId?: string | null,
  userId?: string | null,
): Promise<boolean> {
  if (!rideId || typeof rideId !== "string" || !rideId.trim() || !userId || typeof userId !== "string") {
    return false;
  }
  try {
    const cleanRideId = rideId.trim();
    const ride = await prisma.ride.findUnique({
      where: { id: cleanRideId },
      select: { creatorId: true },
    });
    if (!ride) return false;
    if (ride.creatorId === userId) return true;
    const participant = await prisma.rideParticipant.findFirst({
      where: { rideId: cleanRideId, userId, status: { in: ["ACCEPTED", "COMPLETED"] } },
      select: { id: true },
    });
    return Boolean(participant);
  } catch (err) {
    console.error("[SOCKET] isRideParticipant check error:", err);
    return false;
  }
}

// ─── Module-scope io reference ───────────────────────────────────────────────
// Routes need to emit ride lifecycle events (e.g. `ride-completed`) without
// holding the http server. `getIO()` returns the live instance after
// `createSocketServer` has run, or null in test environments.
let ioInstance: Server | null = null;
// Guards against leaking a duplicate sweep interval if createSocketServer is
// invoked more than once in the same process (the test harness does this
// once per test file — see socketTestServer.ts).
let unresponsiveSweepTimer: ReturnType<typeof setInterval> | null = null;

export function getIO(): Server | null {
  return ioInstance;
}

export interface BroadcastRiderLocationInput {
  rideId: string;
  userId: string;
  name: string;
  avatar?: string | null;
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  altitude?: number | null;
  accuracy?: number | null;
  isMoving?: boolean;
  timestamp?: string;
}

export async function broadcastRiderLocation(
  input: BroadcastRiderLocationInput,
): Promise<boolean> {
  const {
    rideId,
    userId,
    name,
    avatar,
    latitude,
    longitude,
    heading,
    speed,
    altitude,
    accuracy,
    isMoving,
    timestamp,
  } = input;

  if (isRideCompleted(rideId)) return false;

  const now = timestamp || new Date().toISOString();
  const riderPayload = {
    userId,
    name,
    userName: name,
    avatar,
    latitude,
    longitude,
    lat: latitude,
    lon: longitude,
    heading: heading ?? null,
    speed: speed ?? null,
    altitude: altitude ?? null,
    accuracy: accuracy ?? null,
    isMoving: isMoving ?? false,
    timestamp: now,
    updatedAt: now,
  };

  // Cache position in memory / Redis
  await cacheRiderLocation(rideId, userId, {
    userId,
    name,
    avatar,
    latitude,
    longitude,
    heading: heading ?? null,
    speed: speed ?? null,
    isMoving: isMoving ?? false,
    updatedAt: now,
  }).catch(() => {});
  evaluateGroupCohesion(rideId, userId, name, latitude, longitude);
  evaluateRegroupArrival(rideId, userId, name, latitude, longitude);

  const io = getIO();
  if (io) {
    io.to(`ride:${rideId}`).emit("rider_location_updated", riderPayload);
    io.to(`ride:${rideId}`).emit("participant-location", riderPayload);
  }

  return true;
}

/**
 * Batched sibling of broadcastRiderLocation — used by the
 * /:id/telemetry/batch route, which ingests queued offline pings. Only the
 * *final* ping's position is persisted/cached as "current" (there's no
 * per-ping history table, so replaying every ping into LocationService would
 * just overwrite itself N times), but every ping is emitted in order in a
 * single event so a client catching up after a connectivity gap sees the
 * real trajectory instead of a single teleport to the latest point.
 */
export async function broadcastRiderLocationBatch(
  rideId: string,
  userId: string,
  name: string,
  avatar: string | null | undefined,
  pings: Array<Omit<BroadcastRiderLocationInput, "rideId" | "userId" | "name" | "avatar">>,
): Promise<boolean> {
  if (pings.length === 0) return false;
  if (isRideCompleted(rideId)) return false;

  const ordered = pings.map((p) => {
    const now = p.timestamp || new Date().toISOString();
    return {
      userId,
      name,
      userName: name,
      avatar,
      latitude: p.latitude,
      longitude: p.longitude,
      lat: p.latitude,
      lon: p.longitude,
      heading: p.heading ?? null,
      speed: p.speed ?? null,
      altitude: p.altitude ?? null,
      accuracy: p.accuracy ?? null,
      isMoving: p.isMoving ?? false,
      timestamp: now,
      updatedAt: now,
    };
  });

  const last = ordered[ordered.length - 1];
  await cacheRiderLocation(rideId, userId, {
    userId,
    name,
    avatar,
    latitude: last.latitude,
    longitude: last.longitude,
    heading: last.heading,
    speed: last.speed,
    isMoving: last.isMoving,
    updatedAt: last.updatedAt,
  }).catch(() => {});
  evaluateGroupCohesion(rideId, userId, name, last.latitude, last.longitude);
  evaluateRegroupArrival(rideId, userId, name, last.latitude, last.longitude);

  const io = getIO();
  if (io) {
    io.to(`ride:${rideId}`).emit("rider_location_batch", { userId, points: ordered });
    // Also emit the single-point events for the latest ping so clients that
    // only listen for rider_location_updated (not yet updated for the batch
    // event) still see the rider's current position.
    io.to(`ride:${rideId}`).emit("rider_location_updated", last);
    io.to(`ride:${rideId}`).emit("participant-location", last);
  }

  return true;
}

/**
 * Real-time + push fanout for a message sent over the REST fallback
 * (chat.controller). The socket handler does this inline for socket-sent
 * messages; this mirrors it so a message never ends up "in-app only" just
 * because the sender's socket was down.
 */
export async function fanoutNewMessage(opts: {
  conversationId: string;
  senderId: string;
  senderName: string;
  message: any;
  text?: string;
  messageType?: string;
  attachments?: { type?: string }[];
}): Promise<void> {
  const io = getIO();
  const { conversationId, senderId, senderName, message } = opts;

  io?.to(`conversation:${conversationId}`).emit("new_message", {
    message:
      typeof message?.toObject === "function" ? message.toObject() : message,
    conversationId,
  });

  const conversation = await ChatService.getConversationById(conversationId);
  if (!conversation) return;

  const recipientsForPush: string[] = [];
  for (const p of conversation.participants) {
    if (p.userId === senderId) continue;
    io?.to(`user:${p.userId}`).emit("conversation_updated", {
      conversationId,
      lastMessage: {
        text: (opts.text ?? "").slice(0, 200) || "Attachment",
        senderId,
        senderName,
        sentAt: message.createdAt,
        messageType: opts.messageType ?? "text",
      },
    });
    if (!isUserActiveInChat(conversationId, p.userId)) {
      recipientsForPush.push(p.userId);
    }
  }

  if (recipientsForPush.length) {
    const previewText =
      (opts.text ?? "").trim() ||
      (opts.attachments?.length
        ? `Sent ${opts.attachments[0].type}`
        : "New message");
    const convoTitle =
      conversation.metadata?.name ||
      (conversation.type === "direct" ? senderName : "New message");
    await sendPushToUsers(recipientsForPush, {
      title: convoTitle,
      body:
        conversation.type === "direct"
          ? previewText.slice(0, 140)
          : `${senderName}: ${previewText.slice(0, 140)}`,
      channelId: "messages",
      data: {
        notificationType: "MESSAGE",
        relatedType: "conversation",
        relatedId: conversationId,
        messageId: message._id.toString(),
      },
    }).catch((err) => console.error("[chat] REST message push failed:", err));
  }
}

/**
 * Mark a ride as completed: tombstone the id, drop cached rider positions,
 * notify everyone in the ride room, and force them to leave so subsequent
 * location packets can't keep the room alive.
 */
export async function markRideCompleted(rideId: string): Promise<void> {
  completedRideIds.set(rideId, Date.now() + COMPLETED_RIDE_TOMBSTONE_MS);

  // Drop cached rider positions so a rejoin returns an empty list.
  if (redisCacheClient) {
    redisCacheClient.del(`ride:${rideId}:riders`).catch(() => {});
  }
  rideRiderCache.delete(rideId);
  clearRideHealth(rideId);
  releaseRadioLock(rideId);
  clearRegroupState(rideId);

  if (ioInstance) {
    ioInstance.to(`ride:${rideId}`).emit("ride-completed", { rideId });
    // Force-leave the room so reconnects don't auto-rejoin a dead ride.
    try {
      const sockets = await ioInstance.in(`ride:${rideId}`).fetchSockets();
      for (const s of sockets) s.leave(`ride:${rideId}`);
    } catch {
      // Best-effort — if fetchSockets fails (e.g. Redis adapter hiccup) the
      // tombstone in `completedRideIds` still blocks broadcasts.
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: [
        process.env.FRONTEND_URL || "http://localhost:3000",
        process.env.MOBILE_APP_URL || "http://localhost:8081",
        "http://localhost:3000",
        "http://localhost:8081",
      ],
      credentials: true,
    },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    transports: ["websocket", "polling"],
  });

  ioInstance = io;

  if (unresponsiveSweepTimer) clearInterval(unresponsiveSweepTimer);
  unresponsiveSweepTimer = setInterval(sweepUnresponsiveRiders, UNRESPONSIVE_SWEEP_INTERVAL_MS);
  unresponsiveSweepTimer.unref?.();

  // ── Optional Redis adapter for horizontal scaling ────────────────────────

  if (process.env.REDIS_URL) {
    try {
      const pubClient = new Redis(process.env.REDIS_URL);
      const subClient = pubClient.duplicate();

      pubClient.on("error", (err) =>
        console.error("[SOCKET] Redis pub error:", err.message),
      );
      subClient.on("error", (err) =>
        console.error("[SOCKET] Redis sub error:", err.message),
      );

      io.adapter(createAdapter(pubClient, subClient));
      redisCacheClient = pubClient;
      console.log("[SOCKET] Redis adapter attached for scaling");
    } catch (err) {
      console.warn("[SOCKET] Redis adapter failed, using in-memory:", err);
    }
  }

  // ─── Authentication Middleware ──────────────────────────────────────────

  io.use(async (socket, next) => {
    try {
      // Try to authenticate via cookie or Authorization header
      const cookie = socket.handshake.headers.cookie ?? "";
      const authHeader =
        socket.handshake.auth?.token ??
        socket.handshake.headers.authorization ??
        "";

      // Build pseudo-headers for better-auth to parse
      const headers: Record<string, string> = {};
      if (cookie) headers.cookie = cookie;
      if (authHeader) {
        headers.authorization = authHeader.startsWith("Bearer ")
          ? authHeader
          : `Bearer ${authHeader}`;
      }

      const session = await auth.api.getSession({
        headers: fromNodeHeaders(headers as any),
      });

      if (!session?.user?.id) {
        return next(new Error("Authentication required"));
      }

      // Attach user info to socket
      (socket as AuthenticatedSocket).userId = session.user.id;
      (socket as AuthenticatedSocket).userName = session.user.name ?? "Unknown";

      next();
    } catch (err) {
      console.error("[SOCKET] Auth middleware error:", err);
      next(new Error("Authentication failed"));
    }
  });

  // ─── Connection Handler ────────────────────────────────────────────────

  io.on("connection", (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const { userId, userName } = socket;

    console.log(`[SOCKET] User connected: ${userId} (${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId)!.add(socket.id);

    // Auto-join the user's personal room for direct notifications
    socket.join(`user:${userId}`);

    // ── join_conversation ──────────────────────────────────────────────

    socket.on(
      "join_conversation",
      async (
        payload: JoinConversationPayload,
        ack?: (...args: any[]) => void,
      ) => {
        try {
          const { conversationId } = payload;

          // Verify participation
          const allowed = await ChatService.isParticipant(
            conversationId,
            userId,
          );
          if (!allowed) {
            socket.emit("error", {
              event: "join_conversation",
              message: "Access denied",
            });
            ack?.({ success: false, error: "Access denied" });
            return;
          }

          socket.join(`conversation:${conversationId}`);
          addActiveChat(conversationId, userId);

          // Mark messages as delivered
          const { messages } = await ChatService.getMessages(conversationId, {
            limit: 1,
          });
          if (messages.length) {
            await ChatService.markAsDelivered(
              messages[0]._id.toString(),
              userId,
            );
          }

          console.log(
            `[SOCKET] ${userId} joined conversation ${conversationId}`,
          );
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] join_conversation error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // ── leave_conversation ─────────────────────────────────────────────

    socket.on(
      "leave_conversation",
      (payload: JoinConversationPayload, ack?: (...args: any[]) => void) => {
        socket.leave(`conversation:${payload.conversationId}`);
        removeActiveChat(payload.conversationId, userId);
        ack?.({ success: true });
      },
    );

    // ── send_message ───────────────────────────────────────────────────

    socket.on(
      "send_message",
      async (payload: SendMessagePayload, ack?: (...args: any[]) => void) => {
        try {
          const {
            conversationId,
            text,
            messageType,
            attachments,
            location,
            replyTo,
          } = payload;

          // Verify participation
          const allowed = await ChatService.isParticipant(
            conversationId,
            userId,
          );
          if (!allowed) {
            ack?.({ success: false, error: "Access denied" });
            return;
          }

          // Validate content
          if (
            !text?.trim() &&
            (!attachments || !attachments.length) &&
            !location
          ) {
            ack?.({
              success: false,
              error: "Message must have text, attachments, or a location",
            });
            return;
          }

          const message = await ChatService.sendMessage({
            conversationId,
            senderId: userId,
            senderName: userName,
            text,
            messageType: (messageType as MessageType) ?? MessageType.TEXT,
            attachments,
            location,
            replyTo,
          } as import("../services/chat/chat.types.js").SendMessageInput);

          // Broadcast to all participants in the conversation room
          io.to(`conversation:${conversationId}`).emit("new_message", {
            message: message.toObject(),
            conversationId,
          });

          // Also notify users not currently in the room via their personal rooms
          const conversation =
            await ChatService.getConversationById(conversationId);
          if (conversation) {
            const recipientsForPush: string[] = [];
            for (const p of conversation.participants) {
              if (p.userId === userId) continue;

              io.to(`user:${p.userId}`).emit("conversation_updated", {
                conversationId,
                lastMessage: {
                  text: (text ?? "").slice(0, 200) || "Attachment",
                  senderId: userId,
                  senderName: userName,
                  sentAt: message.createdAt,
                  messageType: messageType ?? "text",
                },
              });

              // Suppress push for participants who currently have this chat
              // open. Stale presence (socket dropped without leave) self-heals
              // on disconnect, so the worst case is one missing banner — the
              // unread badge still updates via conversation_updated above.
              if (!isUserActiveInChat(conversationId, p.userId)) {
                recipientsForPush.push(p.userId);
              }
            }

            if (recipientsForPush.length) {
              const previewText =
                (text ?? "").trim() ||
                (attachments?.length
                  ? `Sent ${attachments[0].type}`
                  : "New message");
              const convoTitle =
                conversation.metadata?.name ||
                (conversation.type === "direct" ? userName : "New message");
              sendPushToUsers(recipientsForPush, {
                title: convoTitle,
                body:
                  conversation.type === "direct"
                    ? previewText.slice(0, 140)
                    : `${userName}: ${previewText.slice(0, 140)}`,
                channelId: "messages",
                data: {
                  notificationType: "MESSAGE",
                  relatedType: "conversation",
                  relatedId: conversationId,
                  messageId: message._id.toString(),
                },
              }).catch((err) =>
                console.error("[socket] message push failed:", err),
              );
            }
          }

          // Deliver acknowledgement
          ack?.({ success: true, messageId: message._id.toString() });

          // Emit delivery status back to sender
          socket.emit("message_delivered", {
            messageId: message._id.toString(),
            conversationId,
            deliveredAt: new Date().toISOString(),
          });
        } catch (err) {
          console.error("[SOCKET] send_message error:", err);
          ack?.({ success: false, error: "Failed to send message" });
        }
      },
    );

    // ── typing_start ───────────────────────────────────────────────────

    socket.on("typing_start", (payload: TypingPayload) => {
      socket.to(`conversation:${payload.conversationId}`).emit("user_typing", {
        conversationId: payload.conversationId,
        userId,
        userName,
        isTyping: true,
      });
    });

    // ── typing_stop ────────────────────────────────────────────────────

    socket.on("typing_stop", (payload: TypingPayload) => {
      socket.to(`conversation:${payload.conversationId}`).emit("user_typing", {
        conversationId: payload.conversationId,
        userId,
        userName,
        isTyping: false,
      });
    });

    // ── mark_read ──────────────────────────────────────────────────────

    socket.on(
      "mark_read",
      async (payload: MarkReadPayload, ack?: (...args: any[]) => void) => {
        try {
          const { conversationId } = payload;

          const allowed = await ChatService.isParticipant(
            conversationId,
            userId,
          );
          if (!allowed) {
            ack?.({ success: false, error: "Access denied" });
            return;
          }

          await ChatService.markAsRead(conversationId, userId);

          // Notify sender that their messages were read
          socket.to(`conversation:${conversationId}`).emit("message_read", {
            conversationId,
            userId,
            readAt: new Date().toISOString(),
          });

          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] mark_read error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // ── edit_message (real-time broadcast) ─────────────────────────────

    socket.on(
      "edit_message",
      async (
        payload: { conversationId: string; messageId: string; text: string },
        ack?: (...args: any[]) => void,
      ) => {
        try {
          const message = await ChatService.editMessage(
            payload.messageId,
            userId,
            payload.text,
          );
          if (!message) {
            ack?.({ success: false, error: "Message not found" });
            return;
          }

          io.to(`conversation:${payload.conversationId}`).emit(
            "message_edited",
            {
              conversationId: payload.conversationId,
              messageId: payload.messageId,
              text: payload.text,
              editedAt: message.editedAt?.toISOString(),
            },
          );
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] edit_message error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // ── delete_message (real-time broadcast) ───────────────────────────

    socket.on(
      "delete_message",
      async (
        payload: { conversationId: string; messageId: string },
        ack?: (...args: any[]) => void,
      ) => {
        try {
          const message = await ChatService.deleteMessage(
            payload.messageId,
            userId,
          );
          if (!message) {
            ack?.({ success: false, error: "Message not found" });
            return;
          }

          io.to(`conversation:${payload.conversationId}`).emit(
            "message_deleted",
            {
              conversationId: payload.conversationId,
              messageId: payload.messageId,
            },
          );
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] delete_message error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // ── add_reaction (real-time broadcast) ─────────────────────────────

    socket.on(
      "add_reaction",
      async (
        payload: { conversationId: string; messageId: string; emoji: string },
        ack?: (...args: any[]) => void,
      ) => {
        try {
          await ChatService.addReaction(
            payload.messageId,
            userId,
            payload.emoji,
          );

          io.to(`conversation:${payload.conversationId}`).emit(
            "reaction_updated",
            {
              conversationId: payload.conversationId,
              messageId: payload.messageId,
              userId,
              emoji: payload.emoji,
              action: "add",
            },
          );
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] add_reaction error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // ── remove_reaction ────────────────────────────────────────────────

    socket.on(
      "remove_reaction",
      async (
        payload: { conversationId: string; messageId: string },
        ack?: (...args: any[]) => void,
      ) => {
        try {
          await ChatService.removeReaction(payload.messageId, userId);

          io.to(`conversation:${payload.conversationId}`).emit(
            "reaction_updated",
            {
              conversationId: payload.conversationId,
              messageId: payload.messageId,
              userId,
              emoji: null,
              action: "remove",
            },
          );
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] remove_reaction error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // ─────────────────────────────────────────────────────────────────────
    // ── LOCATION SHARING EVENTS (Snapchat-style map) ────────────────────
    // ─────────────────────────────────────────────────────────────────────

    // ── update_location / update-location ─────────────────────────────

    const handleLocationUpdate = async (
      incoming: LocationUpdatePayload & {
        lat?: number;
        lon?: number;
      },
      ack?: (...args: any[]) => void,
    ) => {
      try {
        const latitude = incoming.latitude ?? incoming.lat;
        const longitude = incoming.longitude ?? incoming.lon;

        if (typeof latitude !== "number" || typeof longitude !== "number") {
          ack?.({
            success: false,
            error: "latitude and longitude are required",
          });
          return;
        }

        // Reject location packets for rides that have already ended. Without
        // this, a slow client could keep broadcasting after the ride summary
        // is generated and pollute the room for any participant who hasn't
        // received the `ride-completed` event yet.
        if (incoming.rideId && isRideCompleted(incoming.rideId)) {
          ack?.({
            success: false,
            error: "Ride has ended",
            code: "RIDE_COMPLETED",
          });
          return;
        }

        const payload: LocationUpdatePayload = {
          latitude,
          longitude,
          altitude: incoming.altitude,
          heading: incoming.heading,
          speed: incoming.speed,
          accuracy: incoming.accuracy,
          battery: incoming.battery,
          isMoving: incoming.isMoving,
          isOnRide: incoming.isOnRide,
          rideId: incoming.rideId,
        };

        // Save to database
        await LocationService.updateLocation({
          userId,
          ...payload,
        });

        // Broadcast to friends who are subscribed
        socket.to(`friends:${userId}`).emit("friend_location_updated", {
          userId,
          userName,
          latitude: payload.latitude,
          longitude: payload.longitude,
          heading: payload.heading,
          speed: payload.speed,
          isMoving: payload.isMoving,
          isOnRide: payload.isOnRide,
          rideId: payload.rideId,
          timestamp: new Date().toISOString(),
        });

        // If on a ride, cache position for late joiners and broadcast to room
        if (payload.isOnRide && payload.rideId) {
          const now = new Date().toISOString();
          const riderPayload = {
            userId,
            name: userName,
            userName,
            latitude: payload.latitude,
            longitude: payload.longitude,
            lat: payload.latitude,
            lon: payload.longitude,
            heading: payload.heading,
            speed: payload.speed,
            altitude: payload.altitude,
            isMoving: payload.isMoving,
            timestamp: now,
          };

          // Persist last-known position so joining riders get it immediately
          cacheRiderLocation(payload.rideId, userId, {
            userId,
            name: userName,
            latitude: payload.latitude,
            longitude: payload.longitude,
            heading: payload.heading ?? null,
            speed: payload.speed ?? null,
            isMoving: payload.isMoving ?? false,
            updatedAt: now,
          }).catch(() => {});
          evaluateGroupCohesion(payload.rideId, userId, userName, payload.latitude, payload.longitude);
          evaluateRegroupArrival(payload.rideId, userId, userName, payload.latitude, payload.longitude);

          socket
            .to(`ride:${payload.rideId}`)
            .emit("rider_location_updated", riderPayload);
          socket
            .to(`ride:${payload.rideId}`)
            .emit("participant-location", riderPayload);
        }

        ack?.({ success: true });
      } catch (err) {
        console.error("[SOCKET] update_location error:", err);
        ack?.({ success: false, error: "Failed to update location" });
      }
    };

    socket.on("update_location", handleLocationUpdate);
    socket.on("update-location", handleLocationUpdate);

    // ── subscribe_to_friend_locations ──────────────────────────────────

    socket.on(
      "subscribe_to_friend_locations",
      async (
        payload: { friendIds: string[] },
        ack?: (...args: any[]) => void,
      ) => {
        try {
          // Join rooms to receive location updates from these friends
          for (const friendId of payload.friendIds) {
            socket.join(`friends:${friendId}`);
          }
          console.log(
            `[SOCKET] ${userId} subscribed to ${payload.friendIds.length} friend locations`,
          );
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] subscribe_to_friend_locations error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // ── unsubscribe_from_friend_locations ──────────────────────────────

    socket.on(
      "unsubscribe_from_friend_locations",
      (payload: { friendIds: string[] }, ack?: (...args: any[]) => void) => {
        for (const friendId of payload.friendIds) {
          socket.leave(`friends:${friendId}`);
        }
        ack?.({ success: true });
      },
    );

    // ── join_ride_tracking / join-ride ────────────────────────────────

    const handleJoinRideTracking = async (
      payload: JoinRidePayload,
      ack?: (...args: any[]) => void,
    ) => {
      try {
        if (!payload?.rideId || typeof payload.rideId !== "string" || !payload.rideId.trim()) {
          socket.emit("error", { event: "join_ride_tracking", message: "Valid rideId is required" });
          ack?.({ success: false, error: "Valid rideId is required" });
          return;
        }

        const rideId = payload.rideId.trim();

        if (!(await isRideParticipant(rideId, userId))) {
          socket.emit("error", { event: "join_ride_tracking", message: "Access denied" });
          ack?.({ success: false, error: "Access denied" });
          return;
        }

        socket.join(`ride:${rideId}`);

        // Track which rides this socket is in for disconnect cleanup
        if (!socketRides.has(socket.id)) socketRides.set(socket.id, new Set());
        socketRides.get(socket.id)!.add(rideId);

        const joinedPayload = {
          userId,
          name: userName,
          timestamp: new Date().toISOString(),
        };
        socket
          .to(`ride:${rideId}`)
          .emit("participant-joined", joinedPayload);
        socket
          .to(`ride:${rideId}`)
          .emit("rider_joined_tracking", joinedPayload);

        // Return all cached rider positions so the joining client can
        // immediately render everyone on the map without waiting for the
        // next 3-second broadcast cycle.
        const riders = await getCachedRiders(rideId);

        console.log(
          `[SOCKET] ${userId} joined ride tracking for ${rideId} (${riders.length} riders cached)`,
        );
        ack?.({ success: true, riders });
      } catch (err) {
        console.error("[SOCKET] join_ride_tracking error:", err);
        ack?.({ success: false, error: "Internal error" });
      }
    };

    socket.on("join_ride_tracking", handleJoinRideTracking);
    socket.on("join-ride", handleJoinRideTracking);

    // ── leave_ride_tracking / leave-ride ──────────────────────────────

    const handleLeaveRideTracking = async (
      payload: JoinRidePayload,
      ack?: (...args: any[]) => void,
    ) => {
      if (!payload?.rideId || typeof payload.rideId !== "string" || !payload.rideId.trim()) {
        ack?.({ success: false, error: "Valid rideId is required" });
        return;
      }
      const rideId = payload.rideId.trim();
      socket.leave(`ride:${rideId}`);
      await removeCachedRider(rideId, userId);
      socketRides.get(socket.id)?.delete(rideId);

      const leftPayload = {
        userId,
        timestamp: new Date().toISOString(),
      };
      socket.to(`ride:${rideId}`).emit("participant-left", leftPayload);
      socket
        .to(`ride:${rideId}`)
        .emit("rider_left_tracking", leftPayload);

      ack?.({ success: true });
    };

    socket.on("leave_ride_tracking", handleLeaveRideTracking);
    socket.on("leave-ride", handleLeaveRideTracking);

    // ── emergency-alert / trigger_emergency ───────────────────────────
    // SOS is safety-critical: the socket broadcast reaches connected riders
    // immediately, and we ALSO push to every ride participant regardless of
    // whether they are online — a backgrounded phone must wake up for SOS.

    const handleEmergencyAlert = async (
      payload: {
        rideId: string;
        latitude?: number;
        longitude?: number;
        lat?: number;
        lon?: number;
        name?: string;
        message?: string;
      },
      ack?: (...args: any[]) => void,
    ) => {
      if (!payload?.rideId || typeof payload.rideId !== "string" || !payload.rideId.trim()) {
        ack?.({ success: false, error: "Valid rideId is required" });
        return;
      }
      const rideId = payload.rideId.trim();

      const latitude = payload.latitude ?? payload.lat;
      const longitude = payload.longitude ?? payload.lon;

      if (typeof latitude !== "number" || typeof longitude !== "number") {
        ack?.({ success: false, error: "latitude and longitude are required" });
        return;
      }

      if (!(await isRideParticipant(rideId, userId))) {
        ack?.({ success: false, error: "Access denied" });
        return;
      }

      const emergencyPayload = {
        userId,
        name: payload.name || userName,
        latitude,
        longitude,
        lat: latitude,
        lon: longitude,
        message: payload.message || "Emergency! I need help!",
        timestamp: new Date().toISOString(),
      };

      bumpRideEventCounter(payload.rideId, "sosCount");

      // 1. Immediate socket broadcast to everyone already in the ride room.
      socket
        .to(`ride:${payload.rideId}`)
        .emit("emergency_alert", emergencyPayload);
      socket
        .to(`ride:${payload.rideId}`)
        .emit("emergency-alert", emergencyPayload);

      // Acknowledge before the async DB work so the sender's UI isn't blocked.
      ack?.({ success: true });

      // 2. Persist notification records + push all participants (including offline).
      // This runs after ack so it never blocks the socket response.
      try {
        const participants = await prisma.rideParticipant.findMany({
          where: {
            rideId: payload.rideId,
            status: { in: ["ACCEPTED", "COMPLETED"] },
            userId: { not: userId }, // sender already knows they triggered SOS
          },
          select: { userId: true },
        });

        const participantIds = participants.map((p) => p.userId);
        if (!participantIds.length) return;

        const sosTitle = `🚨 SOS: ${emergencyPayload.name} needs help!`;
        const sosBody = emergencyPayload.message;

        // Persist a Notification record for each participant so the bell
        // shows the SOS in their history even after the ride ends.
        const records = await prisma.notification.createManyAndReturn({
          data: participantIds.map((uid) => ({
            userId: uid,
            type: NotificationType.SOS_ALERT,
            title: sosTitle,
            message: sosBody,
            relatedType: "ride",
            relatedId: payload.rideId,
            sentViaPush: true, // push fires unconditionally below
          })),
        });

        // Emit notification:new so open notification bells update instantly.
        if (ioInstance) {
          for (const record of records) {
            ioInstance.to(`user:${record.userId}`).emit("notification:new", {
              id: record.id,
              type: record.type,
              title: record.title,
              message: record.message ?? null,
              isRead: false,
              createdAt: record.createdAt.toISOString(),
              relatedId: record.relatedId ?? null,
              relatedType: record.relatedType ?? null,
            });
          }
        }

        // Push ALL participants — SOS bypasses online status and user preferences.
        sendPushToUsers(participantIds, {
          title: sosTitle,
          body: sosBody,
          channelId: channelForType(NotificationType.SOS_ALERT),
          categoryIdentifier: categoryForType(NotificationType.SOS_ALERT),
          data: {
            notificationType: NotificationType.SOS_ALERT,
            relatedType: "ride",
            relatedId: payload.rideId,
          },
        }).catch((err) => console.error("[socket] SOS push failed:", err));
      } catch (err) {
        console.error("[socket] SOS persist/push failed:", err);
      }
    };

    socket.on("trigger_emergency", handleEmergencyAlert);
    socket.on("emergency-alert", handleEmergencyAlert);

    // ── P2P voice calls (custom WebRTC signaling) ───────────────────────
    // Scope: 1:1 rider↔lead only (group mesh calling is explicitly out of
    // scope — the group radio section below covers the "reach everyone"
    // case instead, via a broadcast clip rather than a live mesh). This
    // channel only relays signaling messages (invite/answer/
    // SDP/ICE) between two sockets already both in the ride's room — the
    // actual audio is peer-to-peer once connected (a TURN relay is required
    // in front of this for callers behind carrier-grade NAT, which is the
    // common case on cellular data; that's infra config, not something this
    // signaling layer needs to know about).

    socket.on(
      "call:invite",
      async (
        payload: { toUserId: string; rideId: string },
        ack?: (...args: any[]) => void,
      ) => {
        try {
          const { toUserId, rideId } = payload || ({} as any);
          if (!toUserId || !rideId) {
            ack?.({ success: false, error: "toUserId and rideId are required" });
            return;
          }
          if (toUserId === userId) {
            ack?.({ success: false, error: "Cannot call yourself" });
            return;
          }
          // Scoped to "both people are actually on this ride" — without
          // this, any authenticated user could ring any other online user
          // by passing an arbitrary/unrelated rideId, regardless of shared
          // ride membership.
          const [callerAllowed, calleeAllowed] = await Promise.all([
            isRideParticipant(rideId, userId),
            isRideParticipant(rideId, toUserId),
          ]);
          if (!callerAllowed || !calleeAllowed) {
            ack?.({ success: false, error: "Access denied" });
            return;
          }
          if (activeCallsByUser.has(userId)) {
            ack?.({ success: false, error: "Already in a call", code: "CALLER_BUSY" });
            return;
          }
          if (activeCallsByUser.has(toUserId)) {
            ack?.({ success: false, error: "That rider is already in a call", code: "CALLEE_BUSY" });
            return;
          }
          if (!isUserOnline(toUserId)) {
            ack?.({ success: false, error: "Rider is offline", code: "CALLEE_OFFLINE" });
            return;
          }

          const callId = randomUUID();
          activeCallsByUser.set(userId, { callId, peerId: toUserId, rideId, status: "ringing" });
          activeCallsByUser.set(toUserId, { callId, peerId: userId, rideId, status: "ringing" });

          socket.to(`user:${toUserId}`).emit("call:incoming", {
            callId,
            rideId,
            fromUserId: userId,
            fromName: userName,
          });

          ack?.({ success: true, callId });
        } catch (err) {
          console.error("[SOCKET] call:invite error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // Callee accepts or declines a ringing invite.
    socket.on(
      "call:respond",
      (payload: { callId: string; accepted: boolean }, ack?: (...args: any[]) => void) => {
        const call = activeCallsByUser.get(userId);
        if (!call || call.callId !== payload?.callId) {
          ack?.({ success: false, error: "No matching ringing call" });
          return;
        }

        if (payload.accepted) {
          activeCallsByUser.set(userId, { ...call, status: "active" });
          activeCallsByUser.set(call.peerId, { ...call, peerId: userId, status: "active" });
        } else {
          activeCallsByUser.delete(userId);
          activeCallsByUser.delete(call.peerId);
        }

        socket.to(`user:${call.peerId}`).emit("call:responded", {
          callId: call.callId,
          accepted: payload.accepted,
        });
        ack?.({ success: true });
      },
    );

    // Generic SDP offer/answer/ICE-candidate relay — only forwarded between
    // two sockets that actually have a ringing/active call together, so this
    // can't be used to spam arbitrary users with unsolicited signaling.
    socket.on(
      "call:signal",
      (payload: { callId: string; data: unknown }, ack?: (...args: any[]) => void) => {
        const call = activeCallsByUser.get(userId);
        if (!call || call.callId !== payload?.callId) {
          ack?.({ success: false, error: "No matching call" });
          return;
        }
        socket.to(`user:${call.peerId}`).emit("call:signal", {
          callId: call.callId,
          fromUserId: userId,
          data: payload.data,
        });
        ack?.({ success: true });
      },
    );

    socket.on("call:end", (payload: { callId: string }, ack?: (...args: any[]) => void) => {
      const call = activeCallsByUser.get(userId);
      if (call && call.callId === payload?.callId) {
        endCallForBothSides(userId);
        socket.to(`user:${call.peerId}`).emit("call:ended", { callId: call.callId, reason: "ended" });
      }
      ack?.({ success: true });
    });

    // ── Group radio (half-duplex push-to-talk broadcast) ────────────────
    // See the radioBusyByRide/releaseRadioLock definitions above for the
    // channel-lock model. Recording itself happens client-side; the server
    // only ever sees the final clip (radio:audio), not a live stream.

    socket.on(
      "radio:start",
      async (payload: { rideId: string }, ack?: (...args: any[]) => void) => {
        try {
          const { rideId } = payload || ({} as any);
          if (!rideId) {
            ack?.({ success: false, error: "rideId is required" });
            return;
          }
          if (!(await isRideParticipant(rideId, userId))) {
            ack?.({ success: false, error: "Access denied" });
            return;
          }
          const existing = radioBusyByRide.get(rideId);
          if (existing) {
            ack?.({
              success: false,
              error: `${existing.name} is talking`,
              code: "CHANNEL_BUSY",
              busyUserId: existing.userId,
            });
            return;
          }
          const safetyTimer = setTimeout(() => releaseRadioLock(rideId, userId), RADIO_MAX_HOLD_MS);
          radioBusyByRide.set(rideId, { userId, name: userName, startedAt: Date.now(), safetyTimer });
          socket.to(`ride:${rideId}`).emit("radio:transmission_started", { userId, name: userName });
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] radio:start error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    socket.on(
      "radio:audio",
      (
        payload: { rideId: string; audio: string; durationMs?: number },
        ack?: (...args: any[]) => void,
      ) => {
        try {
          const { rideId, audio, durationMs } = payload || ({} as any);
          const lock = radioBusyByRide.get(rideId);
          if (!lock || lock.userId !== userId) {
            ack?.({ success: false, error: "You don't hold the channel" });
            return;
          }
          if (typeof audio !== "string" || !audio.length) {
            ack?.({ success: false, error: "audio is required" });
            releaseRadioLock(rideId, userId);
            return;
          }
          if (audio.length > MAX_RADIO_CLIP_BASE64_CHARS) {
            ack?.({ success: false, error: "Clip too long" });
            releaseRadioLock(rideId, userId);
            return;
          }
          socket.to(`ride:${rideId}`).emit("radio:transmission", {
            userId,
            name: userName,
            audio,
            durationMs: durationMs ?? null,
            timestamp: new Date().toISOString(),
          });
          ack?.({ success: true });
          releaseRadioLock(rideId, userId);
        } catch (err) {
          console.error("[SOCKET] radio:audio error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    socket.on("radio:cancel", (payload: { rideId: string }, ack?: (...args: any[]) => void) => {
      if (payload?.rideId) releaseRadioLock(payload.rideId, userId);
      ack?.({ success: true });
    });

    // ── Regroup point ─────────────────────────────────────────────────
    // Creator/lead-only — see regroupPointByRide/evaluateRegroupArrival above.

    socket.on(
      "regroup:set",
      async (
        payload: { rideId: string; latitude: number; longitude: number; label?: string },
        ack?: (...args: any[]) => void,
      ) => {
        try {
          const { rideId, latitude, longitude, label } = payload || ({} as any);
          if (!rideId || typeof latitude !== "number" || typeof longitude !== "number") {
            ack?.({ success: false, error: "rideId, latitude, and longitude are required" });
            return;
          }
          if (!(await isCreatorOrLead(rideId, userId))) {
            ack?.({ success: false, error: "Only the ride creator or lead can set a regroup point" });
            return;
          }
          const point: RegroupPoint = {
            latitude,
            longitude,
            label: label ?? null,
            setBy: userId,
            setByName: userName,
            setAt: new Date().toISOString(),
          };
          regroupPointByRide.set(rideId, point);
          regroupArrivals.set(rideId, new Set());
          ioInstance?.to(`ride:${rideId}`).emit("regroup:point_set", point);
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] regroup:set error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    socket.on(
      "regroup:clear",
      async (payload: { rideId: string }, ack?: (...args: any[]) => void) => {
        try {
          const { rideId } = payload || ({} as any);
          if (!rideId || !(await isCreatorOrLead(rideId, userId))) {
            ack?.({ success: false, error: "Access denied" });
            return;
          }
          clearRegroupState(rideId);
          ioInstance?.to(`ride:${rideId}`).emit("regroup:cleared", { rideId });
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] regroup:clear error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // ── Lead reroute broadcast ───────────────────────────────────────────
    // Relays the lead's updated route to every follower so their in-app
    // navigation doesn't keep guiding them along a path the group actually
    // abandoned. Pure relay — the server doesn't validate route geometry,
    // just who's allowed to broadcast one.

    socket.on(
      "route:updated",
      async (
        payload: {
          rideId: string;
          waypoints?: Array<{ latitude: number; longitude: number; name?: string }>;
          endLat?: number;
          endLng?: number;
          endLocation?: string;
          reason?: string;
        },
        ack?: (...args: any[]) => void,
      ) => {
        try {
          const { rideId } = payload || ({} as any);
          if (!rideId) {
            ack?.({ success: false, error: "rideId is required" });
            return;
          }
          if (!(await isCreatorOrLead(rideId, userId))) {
            ack?.({ success: false, error: "Only the ride creator or lead can update the route for the group" });
            return;
          }
          socket.to(`ride:${rideId}`).emit("route_updated", {
            ...payload,
            updatedBy: userId,
            updatedByName: userName,
            timestamp: new Date().toISOString(),
          });
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] route:updated error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // ── request_friend_locations ───────────────────────────────────────
    // Get all friend locations once (for initial map load)

    socket.on(
      "request_friend_locations",
      async (
        payload: Record<string, never>,
        ack?: (...args: any[]) => void,
      ) => {
        try {
          const locations = await LocationService.getFriendLocations(userId);
          ack?.({ success: true, locations });
        } catch (err) {
          console.error("[SOCKET] request_friend_locations error:", err);
          ack?.({ success: false, error: "Internal error", locations: [] });
        }
      },
    );

    // ── toggle_ghost_mode ──────────────────────────────────────────────

    socket.on(
      "toggle_ghost_mode",
      async (
        payload: { enabled: boolean; durationMinutes?: number },
        ack?: (...args: any[]) => void,
      ) => {
        try {
          if (payload.enabled) {
            await LocationSettingsService.enableGhostMode(
              userId,
              payload.durationMinutes,
            );
          } else {
            await LocationSettingsService.disableGhostMode(userId);
          }
          ack?.({ success: true });
        } catch (err) {
          console.error("[SOCKET] toggle_ghost_mode error:", err);
          ack?.({ success: false, error: "Internal error" });
        }
      },
    );

    // ── disconnect ─────────────────────────────────────────────────────

    socket.on("disconnect", async (reason) => {
      console.log(
        `[SOCKET] User disconnected: ${userId} (${socket.id}) — ${reason}`,
      );

      onlineUsers.get(userId)?.delete(socket.id);
      if (onlineUsers.get(userId)?.size === 0) {
        onlineUsers.delete(userId);
        // Once the user has no live sockets we can no longer assume they
        // have any chat open — drop them from every active-chat set so
        // pushes for new messages start landing again.
        for (const [convId, set] of activeChatPresence) {
          if (set.delete(userId) && set.size === 0) {
            activeChatPresence.delete(convId);
          }
        }

        // Gated on "no live sockets left" (not every disconnect) so a
        // reconnect blip on one device doesn't drop an active call.
        const endedCall = endCallForBothSides(userId);
        if (endedCall) {
          socket.to(`user:${endedCall.peerId}`).emit("call:ended", {
            callId: endedCall.callId,
            reason: "peer_disconnected",
          });
        }
      }

      // Remove this rider from all ride caches they were part of
      const rides = socketRides.get(socket.id);
      if (rides) {
        for (const rideId of rides) {
          await removeCachedRider(rideId, userId);
          releaseRadioLock(rideId, userId);
          socket.to(`ride:${rideId}`).emit("rider_left_tracking", {
            userId,
            timestamp: new Date().toISOString(),
          });
        }
        socketRides.delete(socket.id);
      }
    });
  });

  console.log("[SOCKET] Chat & Location socket server initialized");
  return io;
}

/**
 * Utility: check if a user is currently online.
 */
export function isUserOnline(userId: string): boolean {
  return onlineUsers.has(userId) && onlineUsers.get(userId)!.size > 0;
}

/**
 * Utility: get all online user IDs.
 */
export function getOnlineUserIds(): string[] {
  return Array.from(onlineUsers.keys());
}
