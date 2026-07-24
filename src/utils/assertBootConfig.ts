import { isProduction } from '@utils/env';

// Boot-time configuration guard. Some misconfigurations are safe to ignore in
// dev but catastrophic in production — chiefly a weak or placeholder JWT_SECRET,
// which would sign every access token with a guessable key. The env layer only
// checks presence (utils/env.required); this checks STRENGTH, and only in
// production so local/test keep their short dev secrets.

const MIN_JWT_SECRET_BYTES = 32;
const PLACEHOLDER_MARKERS = ['change_me', 'changeme', 'dev-only', 'placeholder', 'secret123'];

const looksLikePlaceholder = (value: string): boolean => {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some(marker => lower.includes(marker));
};

/**
 * Throws if production is misconfigured in a way that undermines security.
 * Called from server boot (server.ts) BEFORE the listener opens, so a bad
 * deploy fails fast and loud rather than serving traffic with a weak secret.
 */
export const assertBootConfig = (): void => {
  if (!isProduction()) return;

  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (jwtSecret.length < MIN_JWT_SECRET_BYTES) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_BYTES} characters in ` +
        'production. Generate one with `openssl rand -base64 48`.'
    );
  }
  if (looksLikePlaceholder(jwtSecret)) {
    throw new Error(
      'JWT_SECRET is a placeholder value. Set a real, random secret in ' +
        'production (`openssl rand -base64 48`).'
    );
  }
};
