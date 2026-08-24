/**
 * Socket.IO test harness.
 *
 * `httpServer`/`createSocketServer` are only wired together inside
 * `startServer()` in server.ts, which is skipped whenever NODE_ENV==="test"
 * (see setupEnv.ts) — so importing `app`/`httpServer` in a vitest file the
 * way rides.test.ts does never actually starts a live socket server. This
 * module does that manually, on an ephemeral port, so tests can open real
 * socket.io-client connections against the exact same auth middleware and
 * event handlers production traffic goes through.
 *
 * The existing better-auth test mock (src/test/mocks/better-auth.ts)
 * authenticates these connections for free: the socket auth middleware in
 * socket.ts calls the same `auth.api.getSession()` the mock intercepts, so a
 * JWT from createTestUser()/createMockToken() works as `auth: { token }` on
 * the client exactly like it works as a Bearer header over REST.
 */

import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { Server } from "socket.io";
import { httpServer } from "../server.js";
import { createSocketServer } from "../lib/socket.js";

let started: { io: Server; port: number } | null = null;

/** Starts the real socket server on an ephemeral port. Idempotent within a test file. */
export async function startSocketTestServer(): Promise<{ io: Server; port: number }> {
  if (started) return started;
  const io = createSocketServer(httpServer);
  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
  started = { io, port };
  return started;
}

export async function stopSocketTestServer(): Promise<void> {
  if (!started) return;
  const { io } = started;
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  started = null;
}

/**
 * Connects an authenticated client socket. Resolves once the connection is
 * fully established (not just "connect" fired) so callers don't race the
 * server's own auth middleware.
 */
export async function connectTestSocket(token: string): Promise<ClientSocket> {
  if (!started) throw new Error("Call startSocketTestServer() before connectTestSocket()");
  const socket = ioClient(`http://127.0.0.1:${started.port}`, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (err) => reject(err));
  });
  return socket;
}

/** Waits for a single named event on a client socket, with a timeout so a missing broadcast fails the test instead of hanging it. */
export function waitForEvent<T = any>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Emits with an ack callback as a promise, for the (payload, ack) handler pattern used throughout socket.ts. */
export function emitWithAck<T = any>(
  socket: ClientSocket,
  event: string,
  payload: any,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ack on "${event}"`)),
      timeoutMs,
    );
    socket.emit(event, payload, (ack: T) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}
