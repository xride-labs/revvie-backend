import { Response } from "express";

// Error codes for consistent API responses
export enum ErrorCode {
  // Validation & Input errors (400)
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INVALID_INPUT = "INVALID_INPUT",
  MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
  INVALID_STATE = "INVALID_STATE",
  PRECONDITION_FAILED = "PRECONDITION_FAILED",
  PROFILE_INCOMPLETE = "PROFILE_INCOMPLETE",
  INELIGIBLE_FOR_ACTION = "INELIGIBLE_FOR_ACTION",

  // Authentication errors (401)
  UNAUTHORIZED = "UNAUTHORIZED",
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",
  ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
  ACCOUNT_DISABLED = "ACCOUNT_DISABLED",
  INVALID_ACCOUNT = "INVALID_ACCOUNT",
  INVALID_OTP = "INVALID_OTP",
  OTP_REQUIRED = "OTP_REQUIRED",
  OTP_EXPIRED = "OTP_EXPIRED",
  OTP_ATTEMPTS_EXCEEDED = "OTP_ATTEMPTS_EXCEEDED",
  INVALID_VERIFICATION_TOKEN = "INVALID_VERIFICATION_TOKEN",
  VERIFICATION_REQUIRED = "VERIFICATION_REQUIRED",
  EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED",
  PHONE_NOT_VERIFIED = "PHONE_NOT_VERIFIED",

  // Payment errors (402)
  PAYMENT_REQUIRED = "PAYMENT_REQUIRED",
  PAYMENT_DECLINED = "PAYMENT_DECLINED",
  CARD_DECLINED = "CARD_DECLINED",
  INVALID_CARD = "INVALID_CARD",
  EXPIRED_CARD = "EXPIRED_CARD",
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  CARD_NOT_SUPPORTED = "CARD_NOT_SUPPORTED",
  CURRENCY_NOT_SUPPORTED = "CURRENCY_NOT_SUPPORTED",

  // Authorization & Permissions errors (403)
  FORBIDDEN = "FORBIDDEN",
  INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",
  ROLE_REQUIRED = "ROLE_REQUIRED",
  SUBSCRIPTION_REQUIRED = "SUBSCRIPTION_REQUIRED",
  AUTHORIZATION_FAILED = "AUTHORIZATION_FAILED",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  ACCESS_DENIED = "ACCESS_DENIED",
  OPERATION_NOT_ALLOWED = "OPERATION_NOT_ALLOWED",
  ACTION_NOT_ALLOWED = "ACTION_NOT_ALLOWED",

  // Not found errors (404)
  NOT_FOUND = "NOT_FOUND",
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  USER_NOT_FOUND = "USER_NOT_FOUND",
  RIDE_NOT_FOUND = "RIDE_NOT_FOUND",
  CLUB_NOT_FOUND = "CLUB_NOT_FOUND",
  LISTING_NOT_FOUND = "LISTING_NOT_FOUND",

  // Method & Format errors (405, 415)
  METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED",
  CONTENT_TYPE_NOT_SUPPORTED = "CONTENT_TYPE_NOT_SUPPORTED",
  FORMAT_NOT_SUPPORTED = "FORMAT_NOT_SUPPORTED",
  VERSION_NOT_SUPPORTED = "VERSION_NOT_SUPPORTED",
  COMPATIBILITY_ERROR = "COMPATIBILITY_ERROR",
  INCOMPATIBLE_VERSION = "INCOMPATIBLE_VERSION",

  // Conflict & Concurrency errors (409)
  CONFLICT = "CONFLICT",
  ALREADY_EXISTS = "ALREADY_EXISTS",
  DUPLICATE_ENTRY = "DUPLICATE_ENTRY",
  LOCKED = "LOCKED",
  LOCK_ERROR = "LOCK_ERROR",
  UNLOCK_ERROR = "UNLOCK_ERROR",

  // Invite & Referral errors
  INVALID_INVITE_CODE = "INVALID_INVITE_CODE",
  INVITE_CODE_EXPIRED = "INVITE_CODE_EXPIRED",
  INVITE_CODE_USED = "INVITE_CODE_USED",
  MAX_INVITES_EXCEEDED = "MAX_INVITES_EXCEEDED",
  INVALID_REFERRAL_CODE = "INVALID_REFERRAL_CODE",
  REFERRAL_CODE_EXPIRED = "REFERRAL_CODE_EXPIRED",
  REFERRAL_CODE_USED = "REFERRAL_CODE_USED",
  MAX_REFERRALS_EXCEEDED = "MAX_REFERRALS_EXCEEDED",

  // File, Media & Upload errors (413, 415, 500)
  INVALID_FILE_TYPE = "INVALID_FILE_TYPE",
  FILE_TOO_LARGE = "FILE_TOO_LARGE",
  UPLOAD_ERROR = "UPLOAD_ERROR",
  UPLOAD_FAILED = "UPLOAD_FAILED",
  FILE_UPLOAD_ERROR = "FILE_UPLOAD_ERROR",
  FILE_PROCESSING_ERROR = "FILE_PROCESSING_ERROR",
  FILE_CORRUPTED = "FILE_CORRUPTED",
  INVALID_IMAGE = "INVALID_IMAGE",
  IMAGE_PROCESSING_ERROR = "IMAGE_PROCESSING_ERROR",
  IMAGE_TOO_SMALL = "IMAGE_TOO_SMALL",
  IMAGE_TOO_LARGE = "IMAGE_TOO_LARGE",
  THUMBNAIL_ERROR = "THUMBNAIL_ERROR",
  VIDEO_PROCESSING_ERROR = "VIDEO_PROCESSING_ERROR",
  AUDIO_PROCESSING_ERROR = "AUDIO_PROCESSING_ERROR",
  CONVERSION_ERROR = "CONVERSION_ERROR",
  EXPORT_ERROR = "EXPORT_ERROR",
  IMPORT_ERROR = "IMPORT_ERROR",

  // Sync & Storage errors
  SYNC_ERROR = "SYNC_ERROR",
  BACKUP_ERROR = "BACKUP_ERROR",
  RESTORE_ERROR = "RESTORE_ERROR",
  MIGRATION_ERROR = "MIGRATION_ERROR",
  DELETION_ERROR = "DELETION_ERROR",
  ARCHIVE_ERROR = "ARCHIVE_ERROR",
  UNARCHIVE_ERROR = "UNARCHIVE_ERROR",

  // Data errors
  STALE_DATA = "STALE_DATA",
  DATA_OUTDATED = "DATA_OUTDATED",
  INVALID_DATA = "INVALID_DATA",
  MALFORMED_DATA = "MALFORMED_DATA",
  CORRUPTED_DATA = "CORRUPTED_DATA",
  INCOMPLETE_DATA = "INCOMPLETE_DATA",
  MISSING_DATA = "MISSING_DATA",
  EXTRA_DATA = "EXTRA_DATA",
  UNEXPECTED_DATA = "UNEXPECTED_DATA",
  DATA_INTEGRITY_ERROR = "DATA_INTEGRITY_ERROR",

  // Response & Pipeline errors
  INVALID_RESPONSE = "INVALID_RESPONSE",
  MALFORMED_RESPONSE = "MALFORMED_RESPONSE",
  UNEXPECTED_RESPONSE = "UNEXPECTED_RESPONSE",
  RESPONSE_TIMEOUT = "RESPONSE_TIMEOUT",
  RESPONSE_TOO_LARGE = "RESPONSE_TOO_LARGE",
  RESPONSE_FORMAT_ERROR = "RESPONSE_FORMAT_ERROR",
  RESPONSE_VALIDATION_ERROR = "RESPONSE_VALIDATION_ERROR",
  RESPONSE_SCHEMA_ERROR = "RESPONSE_SCHEMA_ERROR",
  RESPONSE_MISMATCH = "RESPONSE_MISMATCH",
  RESPONSE_INCONSISTENT = "RESPONSE_INCONSISTENT",
  RESPONSE_STALE = "RESPONSE_STALE",
  RESPONSE_EXPIRED = "RESPONSE_EXPIRED",
  RESPONSE_LOCKED = "RESPONSE_LOCKED",
  RESPONSE_UNAVAILABLE = "RESPONSE_UNAVAILABLE",
  RESPONSE_NOT_READY = "RESPONSE_NOT_READY",
  RESPONSE_NOT_FOUND = "RESPONSE_NOT_FOUND",
  RESPONSE_NOT_ALLOWED = "RESPONSE_NOT_ALLOWED",
  RESPONSE_NOT_AUTHORIZED = "RESPONSE_NOT_AUTHORIZED",
  RESPONSE_NOT_PERMITTED = "RESPONSE_NOT_PERMITTED",
  RESPONSE_NOT_GRANTED = "RESPONSE_NOT_GRANTED",
  RESPONSE_NOT_APPROVED = "RESPONSE_NOT_APPROVED",
  RESPONSE_NOT_CONFIRMED = "RESPONSE_NOT_CONFIRMED",
  RESPONSE_NOT_VERIFIED = "RESPONSE_NOT_VERIFIED",
  RESPONSE_NOT_ACTIVATED = "RESPONSE_NOT_ACTIVATED",
  RESPONSE_NOT_ENABLED = "RESPONSE_NOT_ENABLED",
  RESPONSE_NOT_STARTED = "RESPONSE_NOT_STARTED",
  RESPONSE_NOT_COMPLETED = "RESPONSE_NOT_COMPLETED",
  RESPONSE_NOT_FINISHED = "RESPONSE_NOT_FINISHED",
  RESPONSE_NOT_PROCESSED = "RESPONSE_NOT_PROCESSED",
  RESPONSE_NOT_EXECUTED = "RESPONSE_NOT_EXECUTED",
  RESPONSE_NOT_APPLIED = "RESPONSE_NOT_APPLIED",
  RESPONSE_NOT_SAVED = "RESPONSE_NOT_SAVED",
  RESPONSE_NOT_COMMITTED = "RESPONSE_NOT_COMMITTED",
  RESPONSE_NOT_PERSISTED = "RESPONSE_NOT_PERSISTED",
  RESPONSE_NOT_RETRIEVED = "RESPONSE_NOT_RETRIEVED",
  RESPONSE_NOT_FETCHED = "RESPONSE_NOT_FETCHED",
  RESPONSE_NOT_LOADED = "RESPONSE_NOT_LOADED",
  RESPONSE_NOT_RENDERED = "RESPONSE_NOT_RENDERED",
  RESPONSE_NOT_DISPLAYED = "RESPONSE_NOT_DISPLAYED",
  RESPONSE_NOT_PRESENTED = "RESPONSE_NOT_PRESENTED",
  RESPONSE_NOT_SENT = "RESPONSE_NOT_SENT",
  RESPONSE_NOT_RECEIVED = "RESPONSE_NOT_RECEIVED",
  RESPONSE_NOT_DELIVERED = "RESPONSE_NOT_DELIVERED",
  RESPONSE_NOT_ACKNOWLEDGED = "RESPONSE_NOT_ACKNOWLEDGED",
  RESPONSE_NOT_CONFIRMED_ACKNOWLEDGED = "RESPONSE_NOT_CONFIRMED_ACKNOWLEDGED",

  // Rate Limiting & Quota (429)
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS",
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED",

  // Server & Infrastructure errors (500, 502, 503, 504)
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
  TIMEOUT = "TIMEOUT",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  MAINTENANCE_MODE = "MAINTENANCE_MODE",
  UNSUPPORTED_OPERATION = "UNSUPPORTED_OPERATION",
  DEPENDENCY_FAILURE = "DEPENDENCY_FAILURE",
  CONFIGURATION_ERROR = "CONFIGURATION_ERROR",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  BAD_GATEWAY = "BAD_GATEWAY",
  GATEWAY_TIMEOUT = "GATEWAY_TIMEOUT",
}

export type ApiErrorCode = `${ErrorCode}` | keyof typeof ErrorCode;

// Base response interface
export interface ApiResponseFormat<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code: ApiErrorCode | string;
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
    code: ErrorCode | ApiErrorCode | string = ErrorCode.INTERNAL_ERROR,
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
   * Send a bad request error response (400)
   */
  static badRequest(
    res: Response,
    message: string = "Invalid request",
    code: ErrorCode | ApiErrorCode | string = ErrorCode.INVALID_INPUT,
    details?: any,
  ): void {
    this.error(res, message, 400, code, details);
  }

  /**
   * Send a validation error response (400)
   */
  static validationError(
    res: Response,
    errors: any,
    message: string = "Validation failed",
  ): void {
    this.error(res, message, 400, ErrorCode.VALIDATION_ERROR, errors);
  }

  /**
   * Send an unauthorized response (401)
   */
  static unauthorized(
    res: Response,
    message: string = "Authentication required",
    code: ErrorCode | ApiErrorCode | string = ErrorCode.UNAUTHORIZED,
  ): void {
    this.error(res, message, 401, code);
  }

  /**
   * Send a payment required response (402)
   */
  static paymentRequired(
    res: Response,
    message: string = "Payment required",
    code: ErrorCode | ApiErrorCode | string = ErrorCode.PAYMENT_REQUIRED,
    details?: any,
  ): void {
    this.error(res, message, 402, code, details);
  }

  /**
   * Send a forbidden response (403)
   */
  static forbidden(
    res: Response,
    message: string = "Access denied",
    code: ErrorCode | ApiErrorCode | string = ErrorCode.FORBIDDEN,
  ): void {
    this.error(res, message, 403, code);
  }

  /**
   * Send a not found response (404)
   */
  static notFound(
    res: Response,
    message: string = "Resource not found",
    code: ErrorCode | ApiErrorCode | string = ErrorCode.NOT_FOUND,
  ): void {
    this.error(res, message, 404, code);
  }

  /**
   * Send a conflict response (409)
   */
  static conflict(
    res: Response,
    message: string = "Resource already exists",
    code: ErrorCode | ApiErrorCode | string = ErrorCode.CONFLICT,
  ): void {
    this.error(res, message, 409, code);
  }

  /**
   * Send a rate limited response (429)
   */
  static tooManyRequests(
    res: Response,
    message: string = "Too many requests. Please slow down.",
    code: ErrorCode | ApiErrorCode | string = ErrorCode.RATE_LIMIT_EXCEEDED,
    details?: any,
  ): void {
    this.error(res, message, 429, code, details);
  }

  /**
   * Send a service unavailable response (503)
   */
  static serviceUnavailable(
    res: Response,
    message: string = "Service temporarily unavailable",
    code: ErrorCode | ApiErrorCode | string = ErrorCode.SERVICE_UNAVAILABLE,
    details?: any,
  ): void {
    this.error(res, message, 503, code, details);
  }

  /**
   * Send an internal server error response (500)
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
