import { Response } from "express";

// Error codes for consistent API responses
export enum ErrorCode {
  // Validation errors (400)
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INVALID_INPUT = "INVALID_INPUT",
  MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",

  // Authentication errors (401)
  UNAUTHORIZED = "UNAUTHORIZED",
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  SESSION_EXPIRED = "SESSION_EXPIRED",

  // Authorization errors (403)
  FORBIDDEN = "FORBIDDEN",
  INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",
  ROLE_REQUIRED = "ROLE_REQUIRED",
  SUBSCRIPTION_REQUIRED = "SUBSCRIPTION_REQUIRED",

  // Not found errors (404)
  NOT_FOUND = "NOT_FOUND",
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  USER_NOT_FOUND = "USER_NOT_FOUND",
  RIDE_NOT_FOUND = "RIDE_NOT_FOUND",
  CLUB_NOT_FOUND = "CLUB_NOT_FOUND",
  LISTING_NOT_FOUND = "LISTING_NOT_FOUND",

  // Conflict errors (409)
  CONFLICT = "CONFLICT",
  ALREADY_EXISTS = "ALREADY_EXISTS",
  DUPLICATE_ENTRY = "DUPLICATE_ENTRY",

  // Server errors (500)
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
  UPLOAD_FAILED = "UPLOAD_FAILED",
}

// Base response interface
export interface ApiResponseFormat<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code: string;
    details?: any;
  };
}

// Pagination interface
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedData<T> {
  items: T[];
  pagination: PaginationMeta;
}

export class ApiResponse {
  /**
   * Send a successful response
   */
  static success<T>(
    res: Response,
    data: T = null as T,
    message: string = "Success",
    statusCode: number = 200,
  ): void {
    const response: ApiResponseFormat<T> = {
      success: true,
      message,
      data,
    };
    res.status(statusCode).json(response);
  }

  /**
   * Send a created response (201)
   */
  static created<T>(
    res: Response,
    data: T,
    message: string = "Resource created successfully",
  ): void {
    this.success(res, data, message, 201);
  }

  /**
   * Send a paginated response
   */
  static paginated<T>(
    res: Response,
    items: T[],
    pagination: PaginationMeta,
    message: string = "Data retrieved successfully",
  ): void {
    const data: PaginatedData<T> = { items, pagination };
    this.success(res, data, message);
  }

  /**
   * Send an error response
   */
  static error(
    res: Response,
    message: string,
    statusCode: number = 400,
    code: string = ErrorCode.INTERNAL_ERROR,
    details?: any,
  ): void {
    // Never ship raw stack traces outside development — callers sometimes
    // forward Error objects (or wrappers) as `details`.
    let safeDetails = details;
    if (
      process.env.NODE_ENV !== "development" &&
      safeDetails &&
      typeof safeDetails === "object" &&
      "stack" in safeDetails
    ) {
      const { stack: _stack, ...rest } = safeDetails;
      safeDetails = rest;
    }

    const response: ApiResponseFormat = {
      success: false,
      message,
      error: {
        code,
        ...(safeDetails && { details: safeDetails }),
      },
    };

    // Add stack trace in development
    if (process.env.NODE_ENV === "development" && details?.stack) {
      response.error!.details = {
        ...response.error!.details,
        stack: details.stack,
      };
    }

    res.status(statusCode).json(response);
  }

  /**
   * Send a validation error response
   */
  static validationError(
    res: Response,
    errors: any,
    message: string = "Validation failed",
  ): void {
    this.error(res, message, 400, ErrorCode.VALIDATION_ERROR, errors);
  }

  /**
   * Send an unauthorized response
   */
  static unauthorized(
    res: Response,
    message: string = "Authentication required",
    code: string = ErrorCode.UNAUTHORIZED,
  ): void {
    this.error(res, message, 401, code);
  }

  /**
   * Send a forbidden response
   */
  static forbidden(
    res: Response,
    message: string = "Access denied",
    code: string = ErrorCode.FORBIDDEN,
  ): void {
    this.error(res, message, 403, code);
  }

  /**
   * Send a not found response
   */
  static notFound(
    res: Response,
    message: string = "Resource not found",
    code: string = ErrorCode.NOT_FOUND,
  ): void {
    this.error(res, message, 404, code);
  }

  /**
   * Send a conflict response
   */
  static conflict(
    res: Response,
    message: string = "Resource already exists",
    code: string = ErrorCode.CONFLICT,
  ): void {
    this.error(res, message, 409, code);
  }

  /**
   * Send an internal server error response
   */
  static internalError(
    res: Response,
    message: string = "An unexpected error occurred",
    error?: Error,
    options?: { log?: boolean },
  ): void {
    const shouldLogInConsole =
      process.env.NODE_ENV === "development" && options?.log !== false;

    if (shouldLogInConsole) {
      console.error(`[DEV][INTERNAL_ERROR] ${message}`, error);
    }

    this.error(
      res,
      message,
      500,
      ErrorCode.INTERNAL_ERROR,
      process.env.NODE_ENV === "development"
        ? { stack: error?.stack }
        : undefined,
    );
  }
}
