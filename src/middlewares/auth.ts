import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { required } from '@utils/env';
import { UnauthorizedError, ForbiddenError } from './error';
import User from '@models/user/User';
import RevokedToken from '@models/user/RevokedToken';
import { assertAccessSessionActive } from '@services/authSessionService';
import type { AccessJwtPayload } from '@utils/generateAccessToken';

// Native clients carry the access token in `Authorization: Bearer <jwt>`.
// A cookie fallback is kept so a future web client (or tooling) works unchanged.
export const extractToken = (req: Request): string | undefined => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookieToken = (req as { cookies?: Record<string, string> }).cookies
    ?.access_token;
  return cookieToken || undefined;
};

export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

// Shared blacklist lookup — used by HTTP middleware and the socket handshake.
export const isTokenRevoked = async (token: string): Promise<boolean> => {
  const revoked = await RevokedToken.findOne({
    where: { token_hash: hashToken(token) },
  });
  return revoked !== null;
};

const authenticate = async (req: Request, token: string): Promise<void> => {
  const decoded = jwt.verify(token, required('JWT_SECRET')) as AccessJwtPayload;

  if (await isTokenRevoked(token)) {
    throw new UnauthorizedError('Not authorized, token has been revoked');
  }
  await assertAccessSessionActive(decoded.userId, decoded.sessionId);

  const user = await User.findByPk(decoded.userId);
  if (!user) throw new UnauthorizedError('Not authorized, user not found');
  if (!user.is_active) throw new ForbiddenError('User account is inactive');

  req.user = user;
  req.authSessionId = decoded.sessionId;
  req.authToken = token;
};

// Require a valid session. A 401 here is exactly what drives the client's
// one-shot token refresh (app core/api/client.ts).
export const protect = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);
    if (!token) throw new UnauthorizedError('Not authorized, no token provided');
    await authenticate(req, token);
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Not authorized, invalid token'));
    } else {
      next(error);
    }
  }
};

// Attach the user when a valid token is present, but never reject when it's
// absent — for endpoints readable by anyone yet richer when authenticated.
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);
    if (token) await authenticate(req, token);
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Not authorized, invalid token'));
    } else {
      next(error);
    }
  }
};

/** The authenticated user's id, or throw. Convenience for controllers. */
export const requireUserId = (req: Request): string => {
  if (!req.user) throw new UnauthorizedError('Not authorized');
  return req.user.user_id;
};

/**
 * Gate the /admin surface on the moderator flag. Composes AFTER `protect` (which
 * populates req.user) — a plain user hits a 403, an unauthenticated request a
 * 401 from protect before this ever runs. There is no role system by design:
 * one boolean, two kinds of actor.
 */
export const requireAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    next(new UnauthorizedError('Not authorized'));
    return;
  }
  if (!req.user.is_admin) {
    next(new ForbiddenError('Moderator access required'));
    return;
  }
  next();
};
