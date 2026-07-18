import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { required } from './env';

export interface AccessJwtPayload {
  userId: string;
  jti: string;
  sessionId?: string;
}

// Short-lived access JWTs; longevity comes from the rotating refresh session.
export const DEFAULT_ACCESS_TOKEN_EXPIRY = '15m';

// A per-call random `jti` makes two sign() calls for the same userId in the
// same second produce distinct tokens — required so token revocation (which
// keys on sha256(token)) can never revoke a freshly-minted token.
export const generateAccessToken = (
  userId: string,
  sessionId?: string
): string => {
  const payload: AccessJwtPayload = {
    userId,
    jti: randomUUID(),
    ...(sessionId ? { sessionId } : {}),
  };
  return jwt.sign(payload, required('JWT_SECRET'), {
    expiresIn: (process.env.JWT_EXPIRES_IN ||
      DEFAULT_ACCESS_TOKEN_EXPIRY) as jwt.SignOptions['expiresIn'],
  });
};
