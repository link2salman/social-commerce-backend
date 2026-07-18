import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { ValidationError } from '@middlewares/error';

const flatten = (
  error: z.ZodError
): Array<{ field: string; message: string }> =>
  error.issues.map(issue => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

/** Validate req.body; replaces it with the coerced/defaulted parse result. */
export const validateBody =
  <T extends z.ZodTypeAny>(schema: T, message = 'Validation failed') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new ValidationError(message, flatten(result.error)));
    }
    req.body = result.data;
    next();
  };

/** Validate req.query; attaches the parsed value to req.validatedQuery. */
export const validateQuery =
  <T extends z.ZodTypeAny>(schema: T, message = 'Invalid query parameters') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new ValidationError(message, flatten(result.error)));
    }
    req.validatedQuery = result.data;
    next();
  };

/** Validate req.params (shape only — does not mutate). */
export const validateParams =
  <T extends z.ZodTypeAny>(schema: T, message = 'Invalid path parameters') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return next(new ValidationError(message, flatten(result.error)));
    }
    next();
  };
