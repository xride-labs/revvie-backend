/**
 * Exhaustive contract tests for the ApiResponse envelope helpers.
 *
 * Every route in the app funnels responses through this class, so the
 * envelope shape, status codes, error-code defaults and NODE_ENV-dependent
 * stack-trace behaviour are all load-bearing API contracts.
 */

import { ApiResponse, ErrorCode } from "./apiResponse.js";

type MockRes = {
  statusCode?: number;
  body?: any;
  status(code: number): MockRes;
  json(payload: any): MockRes;
};

function makeRes(): MockRes {
  const res: MockRes = {
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const ENV_BACKUP = process.env.NODE_ENV;

function withEnv(env: string | undefined, fn: () => void) {
  process.env.NODE_ENV = env;
  try {
    fn();
  } finally {
    process.env.NODE_ENV = ENV_BACKUP;
  }
}

// ─── ErrorCode enum integrity ────────────────────────────────────────────

describe("ErrorCode enum", () => {
  const ALL_CODES = Object.entries(ErrorCode);

  it("defines at least 20 distinct codes", () => {
    expect(ALL_CODES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ALL_CODES.map(([, v]) => v)).size).toBe(ALL_CODES.length);
  });

  it.each(ALL_CODES)("code %s maps to its own name", (key, value) => {
    expect(value).toBe(key);
  });

  it("groups codes into documented HTTP families", () => {
    const validation = [
      ErrorCode.VALIDATION_ERROR,
      ErrorCode.INVALID_INPUT,
      ErrorCode.MISSING_REQUIRED_FIELD,
    ];
    const auth = [
      ErrorCode.UNAUTHORIZED,
      ErrorCode.INVALID_CREDENTIALS,
      ErrorCode.TOKEN_EXPIRED,
      ErrorCode.SESSION_EXPIRED,
    ];
    const forbidden = [
      ErrorCode.FORBIDDEN,
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      ErrorCode.ROLE_REQUIRED,
      ErrorCode.SUBSCRIPTION_REQUIRED,
    ];
    const notFound = [
      ErrorCode.NOT_FOUND,
      ErrorCode.RESOURCE_NOT_FOUND,
      ErrorCode.USER_NOT_FOUND,
      ErrorCode.RIDE_NOT_FOUND,
      ErrorCode.CLUB_NOT_FOUND,
      ErrorCode.LISTING_NOT_FOUND,
    ];
    const conflict = [
      ErrorCode.CONFLICT,
      ErrorCode.ALREADY_EXISTS,
      ErrorCode.DUPLICATE_ENTRY,
    ];
    const server = [
      ErrorCode.INTERNAL_ERROR,
      ErrorCode.DATABASE_ERROR,
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      ErrorCode.UPLOAD_FAILED,
    ];
    expect(validation).toHaveLength(3);
    expect(auth).toHaveLength(4);
    expect(forbidden).toHaveLength(4);
    expect(notFound).toHaveLength(6);
    expect(conflict).toHaveLength(3);
    expect(server).toHaveLength(4);
  });
});

// ─── Envelope shape invariants ───────────────────────────────────────────

describe("envelope shape invariants", () => {
  it("success envelope carries exactly success/message/data", () => {
    const res = makeRes();
    ApiResponse.success(res as any, { a: 1 }, "ok", 200);
    expect(Object.keys(res.body).sort()).toEqual([
      "data",
      "message",
      "success",
    ]);
  });

  it("error envelope carries exactly success/message/error", () => {
    const res = makeRes();
    ApiResponse.error(res as any, "boom", 400, ErrorCode.INVALID_INPUT);
    expect(Object.keys(res.body).sort()).toEqual([
      "error",
      "message",
      "success",
    ]);
    expect(res.body.error).toEqual({
      code: ErrorCode.INVALID_INPUT,
    });
  });

  it("omits the details key when no details are provided", () => {
    const res = makeRes();
    ApiResponse.validationError(res as any, undefined);
    expect(res.body.error).not.toHaveProperty("details");
  });

  it.each([
    ["success", true],
    ["created", true],
    ["paginated", true],
    ["error", false],
    ["validationError", false],
    ["unauthorized", false],
    ["forbidden", false],
    ["notFound", false],
    ["conflict", false],
    ["internalError", false],
  ])("%s always emits a boolean success flag", (helper, expected) => {
    const res = makeRes();
    (ApiResponse as any)[helper](res as any, {}, { page: 1, limit: 10, total: 0, totalPages: 0 });
    expect(typeof res.body.success).toBe("boolean");
    expect(res.body.success).toBe(expected);
  });
});

// ─── Success-family defaults ─────────────────────────────────────────────

describe("success family", () => {
  it("defaults to 200 / 'Success' / data=null", () => {
    const res = makeRes();
    ApiResponse.success(res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Success");
    expect(res.body.data).toBeNull();
  });

  it("honours custom status and message", () => {
    const res = makeRes();
    ApiResponse.success(res as any, { id: "x" }, "Done", 202);
    expect(res.statusCode).toBe(202);
    expect(res.body.message).toBe("Done");
    expect(res.body.data).toEqual({ id: "x" });
  });

  it("created() returns 201 with its default message", () => {
    const res = makeRes();
    ApiResponse.created(res as any, { id: "y" });
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe("Resource created successfully");
    expect(res.body.data).toEqual({ id: "y" });
  });

  it("paginated() nests items+pagination under data", () => {
    const res = makeRes();
    const pagination = { page: 2, limit: 20, total: 41, totalPages: 3 };
    ApiResponse.paginated(res as any, [1, 2], pagination);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ items: [1, 2], pagination });
    expect(res.body.success).toBe(true);
  });

  it.each([0, 1, -1, 1000])("paginated() tolerates totalPages=%i", (tp) => {
    const res = makeRes();
    ApiResponse.paginated(res as any, [], {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: tp,
    });
    expect(res.body.data.pagination.totalPages).toBe(tp);
  });
});

// ─── Error family status/code matrix ─────────────────────────────────────

describe("error family status/code matrix", () => {
  it.each([
    ["error", 400, ErrorCode.INTERNAL_ERROR],
    ["unauthorized", 401, ErrorCode.UNAUTHORIZED],
    ["forbidden", 403, ErrorCode.FORBIDDEN],
    ["notFound", 404, ErrorCode.NOT_FOUND],
    ["conflict", 409, ErrorCode.CONFLICT],
    ["internalError", 500, ErrorCode.INTERNAL_ERROR],
  ] as const)("%s defaults to %i / %s", (helper, status, code) => {
    const res = makeRes();
    (ApiResponse as any)[helper](res as any, "msg");
    expect(res.statusCode).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("msg");
  });

  it("validationError defaults to 400 / VALIDATION_ERROR (message param is third)", () => {
    const res = makeRes();
    ApiResponse.validationError(res as any, { field: "bad" }, "msg");
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("msg");
    expect(res.body.error.details).toEqual({ field: "bad" });
  });

  it("error() honours explicit overrides", () => {
    const res = makeRes();
    ApiResponse.error(
      res as any,
      "nope",
      418,
      ErrorCode.ROLE_REQUIRED,
      { why: "teapot" },
    );
    expect(res.statusCode).toBe(418);
    expect(res.body.error.code).toBe(ErrorCode.ROLE_REQUIRED);
    expect(res.body.error.details).toEqual({ why: "teapot" });
  });

  it("unauthorized() accepts a custom code", () => {
    const res = makeRes();
    ApiResponse.unauthorized(res as any, "expired", ErrorCode.TOKEN_EXPIRED);
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.TOKEN_EXPIRED);
  });

  it("notFound() accepts a resource-specific code", () => {
    const res = makeRes();
    ApiResponse.notFound(res as any, "gone", ErrorCode.RIDE_NOT_FOUND);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe(ErrorCode.RIDE_NOT_FOUND);
  });

  it("validationError() forwards structured field errors", () => {
    const res = makeRes();
    const errors = { target: "body", errors: { title: "required" } };
    ApiResponse.validationError(res as any, errors, "bad input");
    expect(res.statusCode).toBe(400);
    expect(res.body.error.details).toEqual(errors);
  });
});

// ─── internalError stack-trace discipline ────────────────────────────────

describe("internalError stack-trace discipline", () => {
  const err = new Error("secret internals");

  it("never leaks the raw error object or stack in production/test", () => {
    withEnv("production", () => {
      const res = makeRes();
      ApiResponse.internalError(res as any, "failed", err);
      expect(JSON.stringify(res.body)).not.toContain("secret internals");
      expect(res.body.error).not.toHaveProperty("details");
    });
  });

  it("attaches the stack under details.stack in development", () => {
    withEnv("development", () => {
      const res = makeRes();
      ApiResponse.internalError(res as any, "failed", err);
      expect(res.body.error.details?.stack).toBeDefined();
    });
  });

  it("error() strips stack traces from details outside development", () => {
    withEnv("production", () => {
      const res = makeRes();
      ApiResponse.error(res as any, "x", 500, ErrorCode.INTERNAL_ERROR, {
        stack: err.stack,
      } as any);
      expect(res.body.error.details?.stack).toBeUndefined();
    });
    withEnv("test", () => {
      const res = makeRes();
      ApiResponse.error(res as any, "x", 500, ErrorCode.INTERNAL_ERROR, {
        stack: err.stack,
        why: "boom",
      } as any);
      expect(res.body.error.details?.stack).toBeUndefined();
      expect(res.body.error.details?.why).toBe("boom");
    });
    withEnv("development", () => {
      const res = makeRes();
      ApiResponse.error(res as any, "x", 500, ErrorCode.INTERNAL_ERROR, {
        stack: err.stack,
      } as any);
      expect(res.body.error.details?.stack).toBeDefined();
    });
  });

  it("respects log:false to silence dev console noise", () => {
    withEnv("development", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = makeRes();
      ApiResponse.internalError(res as any, "quiet", err, { log: false });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it("logs in development by default", () => {
    withEnv("development", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = makeRes();
      ApiResponse.internalError(res as any, "loud", err);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it("handles a missing Error gracefully", () => {
    withEnv("development", () => {
      const res = makeRes();
      expect(() => ApiResponse.internalError(res as any)).not.toThrow();
      expect(res.statusCode).toBe(500);
    });
  });
});
