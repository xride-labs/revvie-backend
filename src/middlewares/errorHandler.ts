import { Request, Response, NextFunction } from "express";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";

/**
 * Global error handler shared by the production server and the test apps.
 *
 * Body-parser failures (malformed JSON, oversized payloads, wrong content
 * types) are client errors and are mapped to 400/413 instead of falling
 * through as 500s — a malformed request must never look like a server fault.
 */
export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (process.env.NODE_ENV === "development") {
    console.error(`[DEV][HTTP_ERROR] ${req.method} ${req.originalUrl}`, err);
  }

  // body-parser sets `type` on its errors and exposes the HTTP status it
  // wants (400 for parse failures, 413 for entity.too.large, 415 for
  // unsupported charset/type).
  if (err?.type && typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500) {
    const isParseFailure = err.type === "entity.parse.failed";
    ApiResponse.error(
      res,
      isParseFailure
        ? "Malformed JSON body"
        : "Request body could not be processed",
      err.statusCode,
      ErrorCode.INVALID_INPUT,
    );
    return;
  }

  // Don't leak the raw Error object to clients in production
  ApiResponse.internalError(
    res,
    "An unexpected error occurred",
    process.env.NODE_ENV === "production" ? undefined : err,
    { log: false },
  );
}
