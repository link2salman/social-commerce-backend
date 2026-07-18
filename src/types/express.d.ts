import type { UserModel } from '@models/user/User';

// Augment Express's Request with the fields our auth + validation middleware
// attach, so controllers read them without a cast.
declare global {
  namespace Express {
    interface Request {
      /** The authenticated user, set by `protect` / `optionalAuth`. */
      user?: UserModel;
      /** The device session id from the access token, set by `protect`. */
      authSessionId?: string;
      /** The raw bearer token, set by `protect` (used for logout revocation). */
      authToken?: string;
      /** Parsed + validated query, set by `validateQuery`. */
      validatedQuery?: unknown;
    }
  }
}

export {};
