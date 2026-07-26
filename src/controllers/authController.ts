import type { Request, Response } from 'express';
import { sendSuccess } from '@utils/responseHandler';
import { asyncHandler } from '@utils/asyncHandler';
import { toSession } from '@serializers/authSerializer';
import * as authService from '@services/authService';
import {
  createAuthSession,
  rotateRefreshSession,
  revokeAccessToken,
  revokeRefreshSession,
  revokeSessionById,
} from '@services/authSessionService';
import type {
  LoginBody,
  RefreshBody,
  SignupBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from '@validators/authValidators';

// POST /v1/auth/signup → 201 { data: Session }
export const signup = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.signup(req.body as SignupBody);
  const tokens = await createAuthSession(user.user_id, req);
  sendSuccess(res, 'Account created', toSession(user.user_id, tokens), 201);
});

// POST /v1/auth/login → 200 { data: Session }
export const login = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.login(req.body as LoginBody);
  const tokens = await createAuthSession(user.user_id, req);
  sendSuccess(res, 'Signed in', toSession(user.user_id, tokens));
});

// POST /v1/auth/refresh → 200 { data: Session } (401 on invalid/expired/reused).
// The refresh token travels in the JSON body (native client, not a cookie).
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refresh_token } = req.body as RefreshBody;
  const rotated = await rotateRefreshSession(refresh_token, req);
  sendSuccess(res, 'Session refreshed', toSession(rotated.user.user_id, rotated));
});

// POST /v1/auth/forgot-password { email }
// Always 200 (even for an unknown email) so it never reveals who has an account
// — which is also why the message is deliberately non-committal.
export const forgotPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { email } = req.body as ForgotPasswordBody;
    await authService.requestPasswordReset(email);
    sendSuccess(res, 'If that account exists, a reset code has been sent');
  }
);

// POST /v1/auth/reset-password { email, code, password }
export const resetPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { email, code, password } = req.body as ResetPasswordBody;
    await authService.resetPassword(email, code, password);
    sendSuccess(res, 'Password reset');
  }
);

// POST /v1/auth/logout (protected)
// Blacklists the presented access token and revokes the refresh session so
// neither can be replayed. Not in the client contract yet, but correct hygiene.
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.authToken;
  if (token) {
    await revokeAccessToken(token, req.user?.user_id ?? null, 'logout');
  }

  const bodyRefresh = (req.body as { refresh_token?: string } | undefined)
    ?.refresh_token;
  if (bodyRefresh) {
    await revokeRefreshSession(bodyRefresh, 'logout');
  } else if (req.authSessionId) {
    await revokeSessionById(req.authSessionId, 'logout');
  }

  sendSuccess(res, 'Signed out');
});
