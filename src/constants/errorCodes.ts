/**
 * Machine-readable error codes — part of the API contract.
 *
 * The `message` on an error response is for humans (logs, debugging). The
 * `code` is for the client: it is stable, never localized, and never rephrased,
 * so the app can branch on it and render its own copy. Every code here has a
 * matching entry in the app's `core/api/errorCodes.ts` + `ERROR_CODE_COPY`;
 * a new code lands in BOTH repos or the app silently falls back to generic copy.
 *
 * Note this is deliberately a *superset* of the reference backend's behaviour.
 * `io-backend` never emits a code, which is why `io-app`'s ERROR_CODE_COPY map
 * is unreachable in practice — a single source of truth that nothing writes to.
 * Codes are emitted here so the app's map is actually load-bearing.
 */

export const ERROR_CODES = {
  // ── Generic, one per AppError subclass (the default when none is given) ──
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // ── Auth: the app branches on these ──────────────────────────────────────
  /** Wrong email/password on sign-in. NOT a session expiry — do not log out. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** The access token/session is gone or expired: the app should refresh once. */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  /** Refresh failed for good (revoked, rotated, unknown): log out, no retry. */
  SESSION_INVALID: 'SESSION_INVALID',
  /** The account is disabled by moderation. Refreshing will not help. */
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  /** Signup collided with an existing email or username. */
  ACCOUNT_EXISTS: 'ACCOUNT_EXISTS',
  /** Password-reset code wrong or past its window. */
  RESET_CODE_INVALID: 'RESET_CODE_INVALID',

  // ── Commerce ─────────────────────────────────────────────────────────────
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  ORDER_STATE_INVALID: 'ORDER_STATE_INVALID',
  NOT_A_SELLER: 'NOT_A_SELLER',

  // ── Moderation ───────────────────────────────────────────────────────────
  NOT_SUSPENDED: 'NOT_SUSPENDED',
  APPEAL_EXISTS: 'APPEAL_EXISTS',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
