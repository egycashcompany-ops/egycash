// The central error handler — the only place errors become HTTP responses
// (Coding Standards §3). Unexpected errors leak no internals.
import { type NextFunction, type Request, type Response } from 'express';
import { ErrorCodes, type ApiFailure } from '@ecms/contracts';
import { AppError, RateLimitedError } from '../../shared/errors';
import { logger } from '../logging/logger';
import { captureError } from '../observability/sentry';
import { getRequestId } from './request-context';

export const notFoundHandler = (_req: Request, res: Response): void => {
  const body: ApiFailure = {
    success: false,
    error: {
      code: ErrorCodes.NOT_FOUND,
      message: 'Route not found',
      requestId: getRequestId() ?? '',
    },
  };
  res.status(404).json(body);
};

export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = getRequestId() ?? '';

  if (error instanceof AppError) {
    if (error.expected) {
      logger.info({ code: error.code, status: error.httpStatus, path: req.path }, error.message);
    } else {
      logger.error({ err: error, path: req.path }, error.message);
      captureError(error, { requestId, path: req.path });
    }
    if (error instanceof RateLimitedError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    const body: ApiFailure = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        requestId,
      },
    };
    res.status(error.httpStatus).json(body);
    return;
  }

  logger.error({ err: error, path: req.path }, 'unhandled error');
  captureError(error, { requestId, path: req.path });
  const body: ApiFailure = {
    success: false,
    error: { code: ErrorCodes.INTERNAL, message: 'Unexpected error', requestId },
  };
  res.status(500).json(body);
};
