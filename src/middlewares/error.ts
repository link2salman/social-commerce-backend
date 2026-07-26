import type { NextFunction, Request, Response } from 'express';
import {
  ValidationError as SequelizeValidationError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  DatabaseError as SequelizeDatabaseError,
  TimeoutError as SequelizeTimeoutError,
  ConnectionError as SequelizeConnectionError,
} from 'sequelize';
import { ERROR_CODES, type ErrorCode } from '@constants/errorCodes';
import logger from '@utils/logger';

// ── Error hierarchy ──────────────────────────────────────────────────────────
// Every subclass fixes a status AND a default machine-readable code. Throw sites
// that the app needs to distinguish pass a more specific code as the last
// argument — e.g. `new UnauthorizedError('Invalid email or password',
// ERROR_CODES.INVALID_CREDENTIALS)` so the client can tell "wrong password"
// (show a form error) from "token aged out" (refresh silently).
export class AppError extends Error {
  statusCode: number;
  code: ErrorCode;
  isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code: ErrorCode = ERROR_CODES.INTERNAL_ERROR
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code: ErrorCode = ERROR_CODES.BAD_REQUEST) {
    super(message, 400, code);
  }
}

export class ValidationError extends AppError {
  errors?: Array<{ field: string; message: string }>;
  constructor(
    message = 'Validation failed',
    errors?: Array<{ field: string; message: string }>,
    code: ErrorCode = ERROR_CODES.VALIDATION_FAILED
  ) {
    super(message, 400, code);
    this.errors = errors;
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = 'Not authorized',
    code: ErrorCode = ERROR_CODES.UNAUTHORIZED
  ) {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'Access forbidden',
    code: ErrorCode = ERROR_CODES.FORBIDDEN
  ) {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', code: ErrorCode = ERROR_CODES.NOT_FOUND) {
    super(`${resource} not found`, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(
    message = 'Resource already exists',
    code: ErrorCode = ERROR_CODES.CONFLICT
  ) {
    super(message, 409, code);
  }
}

// The caller is being rate-limited (too many of some action in a window). 429 so
// the client can distinguish "slow down" from a 4xx mistake or a 5xx fault.
// `retryAfterSeconds` becomes the `Retry-After` header, which the app turns into
// a real countdown instead of guessing.
export class TooManyRequestsError extends AppError {
  retryAfterSeconds: number;
  constructor(message = 'Too many requests', retryAfter = 60) {
    super(message, 429, ERROR_CODES.RATE_LIMITED);
    this.retryAfterSeconds = retryAfter;
  }
}

// A configured-but-absent dependency (payments, storage, push) that the operator
// must enable with env keys. 503 so the client can distinguish "not wired yet"
// from a 4xx client mistake or a 5xx crash.
export class ServiceUnavailableError extends AppError {
  retryAfterSeconds: number;
  constructor(message = 'Service temporarily unavailable', retryAfter = 60) {
    super(message, 503, ERROR_CODES.SERVICE_UNAVAILABLE);
    this.retryAfterSeconds = retryAfter;
  }
}

// ── Global error middleware (must be mounted last) ──────────────────────────
// The one place an error becomes a response body. Shape mirrors the success
// envelope in `utils/responseHandler.ts`:
//
//   { success: false, message, code, errors? }
//
// `message` is for humans (logs, debugging). `code` is the contract the app
// branches on — see `constants/errorCodes.ts` and the app's ERROR_CODE_COPY.
// The app never renders `message` verbatim for anything but a safe-looking 4xx.
const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal Server Error';
  let code: ErrorCode = ERROR_CODES.INTERNAL_ERROR;
  let errors: Array<{ field: string; message: string }> | undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code;
    if (err instanceof ValidationError) errors = err.errors;
  } else if (err instanceof UniqueConstraintError) {
    statusCode = 409;
    code = ERROR_CODES.CONFLICT;
    const field = err.errors[0]?.path ?? 'field';
    message = `${field.charAt(0).toUpperCase()}${field.slice(1)} already exists`;
  } else if (err instanceof SequelizeValidationError) {
    statusCode = 400;
    code = ERROR_CODES.VALIDATION_FAILED;
    message = 'Validation failed';
    errors = err.errors.map(e => ({
      field: e.path ?? 'unknown',
      message: e.message,
    }));
  } else if (err instanceof ForeignKeyConstraintError) {
    statusCode = 400;
    code = ERROR_CODES.BAD_REQUEST;
    message = 'Referenced resource does not exist';
  } else if (
    err instanceof SequelizeTimeoutError ||
    err instanceof SequelizeConnectionError
  ) {
    statusCode = 503;
    code = ERROR_CODES.SERVICE_UNAVAILABLE;
    message = 'Service temporarily unavailable';
  } else if (err instanceof SequelizeDatabaseError) {
    // 22P02 = invalid_text_representation (bad UUID/number cast) — client error.
    const pgCode = (err as unknown as { parent?: { code?: string } }).parent
      ?.code;
    if (pgCode === '22P02') {
      statusCode = 400;
      code = ERROR_CODES.BAD_REQUEST;
      message = 'Invalid request parameter';
    } else {
      statusCode = 500;
      code = ERROR_CODES.INTERNAL_ERROR;
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
    logger.debug(
      { path: req.originalUrl, method: req.method, code },
      message
    );
  }

  // Well-behaved clients honour Retry-After. Set it wherever we know a sensible
  // wait; the app surfaces it as "try again in Ns" rather than a bare failure.
  if (
    err instanceof TooManyRequestsError ||
    err instanceof ServiceUnavailableError
  ) {
    res.setHeader('Retry-After', String(err.retryAfterSeconds));
  } else if (statusCode === 503) {
    res.setHeader('Retry-After', '60');
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    ...(errors && { errors }),
    ...(process.env.NODE_ENV === 'development' &&
      statusCode >= 500 && { stack: err.stack }),
  });
};

export default errorMiddleware;
