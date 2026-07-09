// Typed error hierarchy (Coding Standards §3). The central error handler is the
// only place these become HTTP responses.
import { ErrorCodes, type ApiErrorDetail, type ErrorCode } from '@ecms/contracts';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: ApiErrorDetail[] | undefined;
  /** Expected business failures are logged at info, not error. */
  readonly expected: boolean;

  constructor(
    code: ErrorCode,
    httpStatus: number,
    message: string,
    options?: { details?: ApiErrorDetail[]; cause?: unknown; expected?: boolean },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = options?.details;
    this.expected = options?.expected ?? true;
  }
}

export class ValidationError extends AppError {
  constructor(details: ApiErrorDetail[], message = 'Validation failed') {
    super(ErrorCodes.VALIDATION_FAILED, 400, message, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(code: ErrorCode = ErrorCodes.UNAUTHENTICATED, message = 'Authentication required') {
    super(code, 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(ErrorCodes.FORBIDDEN, 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(ErrorCodes.NOT_FOUND, 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Duplicate resource', code: ErrorCode = ErrorCodes.DUPLICATE) {
    super(code, 409, message);
  }
}

export class StaleDocumentError extends AppError {
  constructor(message = 'Document was modified by someone else — refetch and retry') {
    super(ErrorCodes.STALE_DOCUMENT, 409, message);
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCodes.BUSINESS_RULE_VIOLATION) {
    super(code, 422, message);
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(ErrorCodes.RATE_LIMITED, 429, 'Too many requests');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class IntegrationError extends AppError {
  constructor(message = 'External integration unavailable') {
    super(ErrorCodes.INTEGRATION_UNAVAILABLE, 503, message, { expected: false });
  }
}

export class InternalError extends AppError {
  constructor(cause?: unknown) {
    super(ErrorCodes.INTERNAL, 500, 'Unexpected error', { cause, expected: false });
  }
}
