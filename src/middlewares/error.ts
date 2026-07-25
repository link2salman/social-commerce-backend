import type { NextFunction, Request, Response } from 'express';
import {
  ValidationError as SequelizeValidationError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  DatabaseError as SequelizeDatabaseError,
  TimeoutError as SequelizeTimeoutError,
  ConnectionError as SequelizeConnectionError,
} from 'sequelize';
import logger from '@utils/logger';

// ── Error hierarchy ──────────────────────────────────────────────────────────
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400);
  }
}

export class ValidationError extends AppError {
  errors?: Array<{ field: string; message: string }>;
  constructor(
    message = 'Validation failed',
    errors?: Array<{ field: string; message: string }>
  ) {
    super(message, 400);
    this.errors = errors;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Not authorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409);
  }
}

// The caller is being rate-limited (too many of some action in a window). 429 so
// the client can distinguish "slow down" from a 4xx mistake or a 5xx fault.
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
  }
}

// A configured-but-absent dependency (payments, storage, push) that the operator
// must enable with env keys. 503 so the client can distinguish "not wired yet"
// from a 4xx client mistake or a 5xx crash.
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503);
  }
}

// ── Global error middleware (must be mounted last) ──────────────────────────
// Emits a small { message } body. The mobile client (ky) treats any non-2xx as
// an error by status code alone and never parses the body — but a clean shape
// keeps logs and any tooling honest. 401 specifically drives the client's
// one-shot refresh (see the app's core/api/client.ts).
const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal Server Error';
  let errors: Array<{ field: string; message: string }> | undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    if (err instanceof ValidationError) errors = err.errors;
  } else if (err instanceof UniqueConstraintError) {
    statusCode = 409;
    const field = err.errors[0]?.path ?? 'field';
    message = `${field.charAt(0).toUpperCase()}${field.slice(1)} already exists`;
  } else if (err instanceof SequelizeValidationError) {
    statusCode = 400;
    message = 'Validation failed';
    errors = err.errors.map(e => ({
      field: e.path ?? 'unknown',
      message: e.message,
    }));
  } else if (err instanceof ForeignKeyConstraintError) {
    statusCode = 400;
    message = 'Referenced resource does not exist';
  } else if (
    err instanceof SequelizeTimeoutError ||
    err instanceof SequelizeConnectionError
  ) {
    statusCode = 503;
    message = 'Service temporarily unavailable';
  } else if (err instanceof SequelizeDatabaseError) {
    // 22P02 = invalid_text_representation (bad UUID/number cast) — client error.
    const pgCode = (err as unknown as { parent?: { code?: string } }).parent
      ?.code;
    if (pgCode === '22P02') {
      statusCode = 400;
      message = 'Invalid request parameter';
    } else {
      statusCode = 500;
      message = 'A database error occurred';
    }
  } else if (err.message) {
    message = err.message;
  }

  // 5xx is a genuine fault — log with the stack. 4xx are expected client
  // outcomes; log at debug so the signal stays clean.
  if (statusCode >= 500) {
    logger.error({ err, path: req.originalUrl, method: req.method }, message);
  } else {
    logger.debug({ path: req.originalUrl, method: req.method }, message);
  }

  res.status(statusCode).json({
    message,
    ...(errors && { errors }),
    ...(process.env.NODE_ENV === 'development' &&
      statusCode >= 500 && { stack: err.stack }),
  });
};

export default errorMiddleware;
