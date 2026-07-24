import crypto from 'crypto';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import { Op, type Transaction } from 'sequelize';

import { sequelize } from '@config/db';
import { UnauthorizedError } from '@middlewares/error';
import User, { type UserModel } from '@models/user/User';
import UserSession, {
  type UserSessionDeviceMetadata,
  type UserSessionModel,
} from '@models/user/UserSession';
import RevokedToken from '@models/user/RevokedToken';
import { generateAccessToken } from '@utils/generateAccessToken';
import type { TokenRevocationReason } from '@constants/enums';
import logger from '@utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Rotating refresh sessions, adapted from the reference backend. Security model
// is identical (hashed storage, one-time rotation, reuse detection, device
// sessions); only the TRANSPORT differs — a native client carries the refresh
// token in the JSON body / Keychain, not an httpOnly cookie. The controller
// reads req.body.refreshToken and returns the new token in the body; this
// service is transport-agnostic.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_REFRESH_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_SECRET_BYTES = 32;
const REVOKED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AuthSessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  session: UserSessionModel;
}

export interface RotatedAuthSessionTokens extends AuthSessionTokens {
  user: UserModel;
}

const clip = (value: string | undefined | null, max: number): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const deviceType = (ua: string | null): string | null => {
  if (!ua) return null;
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobile|Android|iPhone|iPod/i.test(ua)) return 'mobile';
  if (/Macintosh|Windows NT|Linux|X11/i.test(ua)) return 'desktop';
  return 'unknown';
};

export const getSessionDeviceMetadata = (
  req?: Request
): UserSessionDeviceMetadata => {
  const userAgent = clip(req?.get('user-agent'), 500);
  const forwarded = clip(req?.get('x-forwarded-for')?.split(',')[0], 45);
  const ipAddress = forwarded ?? clip(req?.ip, 45);
  return {
    user_agent: userAgent,
    ip_address: ipAddress,
    device_type: deviceType(userAgent),
    device_label: deviceType(userAgent),
  };
};

const getRefreshTtlMs = (): number => {
  const value =
    process.env.REFRESH_TOKEN_EXPIRES_IN || DEFAULT_REFRESH_TOKEN_EXPIRY;
  const parsed = ms(value);
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('REFRESH_TOKEN_EXPIRES_IN must be a positive duration');
  }
  return parsed;
};

const refreshExpiresAt = (now = new Date()): Date =>
  new Date(now.getTime() + getRefreshTtlMs());

// Refresh token = `<sessionId>.<secret>`. Only sha256(token) is stored, so the
// DB never holds a usable credential.
const newRefreshToken = (sessionId: string): string =>
  `${sessionId}.${crypto
    .randomBytes(REFRESH_TOKEN_SECRET_BYTES)
    .toString('base64url')}`;

const parseRefreshToken = (token: string): { sessionId: string } | null => {
  const [sessionId, secret, extra] = token.split('.');
  if (!sessionId || !secret || extra !== undefined) return null;
  if (!UUID_RE.test(sessionId)) return null;
  return { sessionId };
};

export const hashRefreshToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const hashesMatch = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

const loadActiveUser = async (
  userId: string,
  transaction?: Transaction
): Promise<UserModel> => {
  const user = await User.findByPk(userId, { transaction });
  if (!user) throw new UnauthorizedError('Refresh session user not found');
  if (!user.is_active) throw new UnauthorizedError('User account is inactive');
  return user;
};

const applyMetadata = (metadata: UserSessionDeviceMetadata) => ({
  user_agent: metadata.user_agent,
  ip_address: metadata.ip_address,
  device_type: metadata.device_type,
  device_label: metadata.device_label,
  device_metadata: metadata,
});

/** The check `protect` and the socket handshake both run: is this device session live? */
export const assertAccessSessionActive = async (
  userId: string,
  sessionId: string | undefined | null,
  transaction?: Transaction
): Promise<void> => {
  if (!sessionId) return; // legacy tokens without a session id age out naturally
  if (!UUID_RE.test(sessionId)) {
    throw new UnauthorizedError('Not authorized, invalid session');
  }
  const session = await UserSession.findByPk(sessionId, {
    attributes: ['session_id', 'user_id', 'revoked_at', 'expires_at'],
    transaction,
  });
  if (!session || session.user_id !== userId) {
    throw new UnauthorizedError('Not authorized, session not found');
  }
  if (session.revoked_at) {
    throw new UnauthorizedError('Not authorized, session has been revoked');
  }
  if (session.expires_at.getTime() <= Date.now()) {
    throw new UnauthorizedError('Not authorized, session has expired');
  }
};

export const createAuthSession = async (
  userId: string,
  req?: Request
): Promise<AuthSessionTokens> => {
  const now = new Date();
  const sessionId = crypto.randomUUID();
  const refreshToken = newRefreshToken(sessionId);
  const expiry = refreshExpiresAt(now);
  const metadata = getSessionDeviceMetadata(req);

  const session = await UserSession.create({
    session_id: sessionId,
    user_id: userId,
    refresh_token_hash: hashRefreshToken(refreshToken),
    ...applyMetadata(metadata),
    last_used_at: now,
    expires_at: expiry,
  });

  return {
    accessToken: generateAccessToken(userId, sessionId),
    refreshToken,
    refreshTokenExpiresAt: expiry,
    session,
  };
};

export const rotateRefreshSession = async (
  refreshToken: string,
  req?: Request
): Promise<RotatedAuthSessionTokens> => {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) throw new UnauthorizedError('Invalid refresh token');

  let failure: UnauthorizedError | null = null;
  const rotated = await sequelize.transaction(async transaction => {
    const session = await UserSession.findByPk(parsed.sessionId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!session) {
      failure = new UnauthorizedError('Invalid refresh token');
      return null;
    }
    const now = new Date();
    if (session.revoked_at) {
      failure = new UnauthorizedError('Refresh session has been revoked');
      return null;
    }
    if (session.expires_at.getTime() <= now.getTime()) {
      await session.update(
        { revoked_at: now, revoked_reason: 'expired', last_used_at: now },
        { transaction }
      );
      failure = new UnauthorizedError('Refresh session has expired');
      return null;
    }

    // Reuse detection: a presented token whose hash no longer matches the
    // stored (rotated) one means the token was replayed — revoke the session.
    if (!hashesMatch(hashRefreshToken(refreshToken), session.refresh_token_hash)) {
      await session.update(
        {
          revoked_at: now,
          revoked_reason: 'refresh_reuse',
          last_used_at: now,
          ...applyMetadata(getSessionDeviceMetadata(req)),
        },
        { transaction }
      );
      logger.warn(
        { sessionId: session.session_id, userId: session.user_id },
        'auth.refresh.reuse_detected'
      );
      failure = new UnauthorizedError('Refresh token has already been rotated');
      return null;
    }

    const user = await loadActiveUser(session.user_id, transaction);
    const nextRefresh = newRefreshToken(session.session_id);
    const nextExpiry = refreshExpiresAt(now);

    await session.update(
      {
        refresh_token_hash: hashRefreshToken(nextRefresh),
        last_used_at: now,
        expires_at: nextExpiry,
        rotation_count: session.rotation_count + 1,
        ...applyMetadata(getSessionDeviceMetadata(req)),
      },
      { transaction }
    );

    return {
      accessToken: generateAccessToken(user.user_id, session.session_id),
      refreshToken: nextRefresh,
      refreshTokenExpiresAt: nextExpiry,
      session,
      user,
    };
  });

  if (failure) throw failure;
  if (!rotated) throw new UnauthorizedError('Invalid refresh token');
  return rotated;
};

export const revokeSessionById = async (
  sessionId: string | undefined,
  reason: string
): Promise<boolean> => {
  if (!sessionId || !UUID_RE.test(sessionId)) return false;
  const [updated] = await UserSession.update(
    { revoked_at: new Date(), revoked_reason: reason },
    { where: { session_id: sessionId, revoked_at: null } }
  );
  return updated > 0;
};

export const revokeRefreshSession = async (
  refreshToken: string | undefined,
  reason: string
): Promise<boolean> => {
  if (!refreshToken) return false;
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return false;
  const session = await UserSession.findByPk(parsed.sessionId);
  if (!session || session.revoked_at) return false;
  const revokeReason = hashesMatch(
    hashRefreshToken(refreshToken),
    session.refresh_token_hash
  )
    ? reason
    : 'refresh_reuse';
  await session.update({ revoked_at: new Date(), revoked_reason: revokeReason });
  return true;
};

export const revokeAllUserSessions = async (
  userId: string,
  reason: string,
  transaction?: Transaction
): Promise<number> => {
  const [updated] = await UserSession.update(
    { revoked_at: new Date(), revoked_reason: reason },
    { where: { user_id: userId, revoked_at: null }, transaction }
  );
  return updated;
};

// Blacklist an access token so it can't be replayed before its natural expiry
// (logout / password change). token_hash is sha256(token) — the SAME hex the
// HTTP middleware's isTokenRevoked() looks up, so a blacklisted token is
// rejected on its next request. Lives here (not in the controller) to keep the
// controller free of model access and jwt internals.
const ACCESS_TOKEN_FALLBACK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const revokeAccessToken = async (
  token: string,
  userId: string | null,
  reason: TokenRevocationReason
): Promise<void> => {
  try {
    const decoded = jwt.decode(token) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + ACCESS_TOKEN_FALLBACK_TTL_MS);
    await RevokedToken.create({
      token_hash: hashRefreshToken(token), // generic sha256(hex), matches the middleware
      user_id: userId,
      expires_at: expiresAt,
      reason,
    });
  } catch (err) {
    logger.error({ err }, 'auth.revokeAccessToken.failed');
  }
};

export const cleanupExpiredOrRevokedSessions = async (
  now = new Date()
): Promise<number> => {
  const cutoff = new Date(now.getTime() - REVOKED_RETENTION_MS);
  return UserSession.destroy({
    where: {
      [Op.or]: [
        { expires_at: { [Op.lt]: now } },
        { revoked_at: { [Op.lt]: cutoff } },
      ],
    },
  });
};
