import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Wrap an async controller so a rejected promise is forwarded to Express's
// error middleware instead of crashing the process. Express 4 does not await
// handlers, so an un-caught async throw becomes an unhandled rejection.
export const asyncHandler =
  (
    handler: (
      req: Request,
      res: Response,
      next: NextFunction
    ) => Promise<unknown>
  ): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next);
  };
