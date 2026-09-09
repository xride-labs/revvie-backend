import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { ApiResponse } from "../lib/utils/apiResponse.js";

/**
 * Validation target type
 */
type ValidationTarget = "body" | "query" | "params";

/**
 * Validation configuration
 */
interface ValidationConfig {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Format Zod errors into a user-friendly structure
 */
function formatZodErrors(error: ZodError): Record<string, string[]> {
  const formattedErrors: Record<string, string[]> = {};

  error.issues.forEach((err) => {
    const path = err.path.join(".") || "value";
    if (!formattedErrors[path]) {
      formattedErrors[path] = [];
    }
    formattedErrors[path].push(err.message);
  });

  return formattedErrors;
}

/**
 * Validate a single target (body, query, or params)
 */
export function validateSingle(schema: ZodSchema, target: ValidationTarget) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req[target];
      const result = schema.safeParse(data);

      if (!result.success) {
        const errors = formatZodErrors(result.error);
        return ApiResponse.validationError(
          res,
          {
            target,
            errors,
          },
          `Validation failed for ${target}`,
        );
      }

      // Replace with parsed/transformed data
      (req as any)[target] = result.data;
      next();
    } catch (error) {
      console.error(`Validation error for ${target}:`, error);
      return ApiResponse.internalError(
        res,
        "Validation processing failed",
        error as Error,
      );
    }
  };
}

/**
 * Validate request body
 */
export function validateBody(schema: ZodSchema) {
  return validateSingle(schema, "body");
}

/**
 * Validate request query parameters
 */
export function validateQuery(schema: ZodSchema) {
  return validateSingle(schema, "query");
}

/**
 * Validate request URL parameters
 */
export function validateParams(schema: ZodSchema) {
  return validateSingle(schema, "params");
}

/**
 * Validate multiple targets at once
 */
export function validate(config: ValidationConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const allErrors: Record<string, any> = {};
    let hasErrors = false;

    for (const [target, schema] of Object.entries(config) as [
      ValidationTarget,
      ZodSchema,
    ][]) {
      if (!schema) continue;

      const data = req[target];
      const result = schema.safeParse(data);

      if (!result.success) {
        hasErrors = true;
        allErrors[target] = formatZodErrors(result.error);
      } else {
        // Replace with parsed/transformed data
        (req as any)[target] = result.data;
      }
    }

    if (hasErrors) {
      return ApiResponse.validationError(res, allErrors, "Validation failed");
    }

    next();
  };
}

/**
 * Express async handler wrapper to catch errors
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      console.error("Async handler error:", error);
      if (error instanceof ZodError) {
        return ApiResponse.validationError(res, formatZodErrors(error));
      }
      return ApiResponse.internalError(
        res,
        "An unexpected error occurred",
        error,
      );
    });
  };
}
