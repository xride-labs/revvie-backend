import { describe, it, expect, vi } from "vitest";
import { requireRole, UserRole } from "./rbac.js";
import { Request, Response, NextFunction } from "express";

// Mock permissions and prisma dependencies
vi.mock("../lib/prisma.js", () => ({
  default: {
    userRoleAssignment: {
      findMany: vi.fn().mockResolvedValue([{ role: "ADMIN" }]),
    },
  },
}));

describe("rbac middleware", () => {
  it("should return 401 Unauthorized if session or user is missing", async () => {
    const middleware = requireRole(UserRole.ADMIN);
    const req = {} as Request;
    let statusCode = 0;
    let jsonBody: any = null;

    const res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: any) => {
        jsonBody = data;
        return res;
      },
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    await middleware(req, res, next);

    expect(statusCode).toBe(401);
    expect(jsonBody.success).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next() and populate req.userRoles if user has required role", async () => {
    const middleware = requireRole(UserRole.ADMIN);
    const req = {
      session: { user: { id: "user-123" } },
    } as unknown as Request;

    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await middleware(req, res, next);

    expect((req as any).userRoles).toEqual(["ADMIN"]);
    expect(next).toHaveBeenCalled();
  });
});
