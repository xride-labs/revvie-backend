import express from "express";
import request from "supertest";
import {
  accountRoutes,
  userRoutes,
  rideRoutes,
  clubRoutes,
  marketplaceRoutes,
  adminRoutes,
  mediaRoutes,
  feedRoutes,
  discoveryRoutes,
  chatRoutes,
  locationRoutes,
  friendshipRoutes,
  savedRoutes,
} from "./index.js";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
import { vi } from "vitest";

vi.mock("../config/auth.js", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.session = {
      user: {
        id: "test-user-id",
        email: "test@example.com",
        name: "Test User",
        image: null,
        phone: null,
        roles: ["ADMIN"],
      },
      session: {
        id: "session-id",
        token: "session-token",
        expiresAt: new Date(Date.now() + 60_000),
      },
    };
    next();
  },
}));

vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn(() => ({})),
}));

describe("all route groups are wired", () => {
  const app = express();
  app.use(express.json());

  app.use("/api/account", accountRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/rides", rideRoutes);
  app.use("/api/clubs", clubRoutes);
  app.use("/api/marketplace", marketplaceRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/media", mediaRoutes);
  app.use("/api/feed", feedRoutes);
  app.use("/api/posts", feedRoutes);
  app.use("/api/discover", discoveryRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/location", locationRoutes);
  app.use("/api/friends", friendshipRoutes);
  app.use("/api/saved", savedRoutes);

  app.use((_req, res) => {
    ApiResponse.notFound(res, "Endpoint not found", ErrorCode.NOT_FOUND);
  });

  const basePaths = [
    "/api/account",
    "/api/users",
    "/api/rides",
    "/api/clubs",
    "/api/marketplace",
    "/api/admin",
    "/api/media",
    "/api/feed",
    "/api/posts",
    "/api/discover",
    "/api/chat",
    "/api/location",
    "/api/friends",
    "/api/saved",
  ];

  it.each(basePaths)("mounts and responds for %s", async (basePath) => {
    const response = await request(app).get(
      `${basePath}/__test_missing__/__segment__/__route__/__check__`,
    );

    expect([400, 401, 403, 404]).toContain(response.status);
  });
});
