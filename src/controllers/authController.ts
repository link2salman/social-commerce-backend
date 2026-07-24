import type { Request, Response } from 'express';
import { send, sendOk } from '@utils/respond';
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

// POST /v1/auth/signup → 201 Session
export const signup = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.signup(req.body as SignupBody);
  const tokens = await createAuthSession(user.user_id, req);
  send(res, toSession(user.user_id, tokens), 201);
});

// POST /v1/auth/login → 200 Session
export const login = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.login(req.body as LoginBody);
  const tokens = await createAuthSession(user.user_id, req);
  send(res, toSession(user.user_id, tokens), 200);
});

// POST /v1/auth/refresh → 200 Session (401 on invalid/expired/reused token).
// The refresh token travels in the JSON body (native client, not a cookie).
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as RefreshBody;
  const rotated = await rotateRefreshSession(refreshToken, req);
  send(res, toSession(rotated.user.user_id, rotated), 200);
});

// POST /v1/auth/forgot-password { email } → { ok: true }
// Always 200 (even for an unknown email) so it never reveals who has an account.
export const forgotPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { email } = req.body as ForgotPasswordBody;
    await authService.requestPasswordReset(email);
    sendOk(res);
  }
);

// POST /v1/auth/reset-password { email, code, password } → { ok: true }
export const resetPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { email, code, password } = req.body as ResetPasswordBody;
    await authService.resetPassword(email, code, password);
    sendOk(res);
  }
);

// POST /v1/auth/logout (protected) → { ok: true }
// Blacklists the presented access token and revokes the refresh session so
// neither can be replayed. Not in the client contract yet, but correct hygiene.
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.authToken;
  if (token) {
    await revokeAccessToken(token, req.user?.user_id ?? null, 'logout');
  }

  const bodyRefresh = (req.body as { refreshToken?: string } | undefined)
    ?.refreshToken;
  if (bodyRefresh) {
    await revokeRefreshSession(bodyRefresh, 'logout');
  } else if (req.authSessionId) {
    await revokeSessionById(req.authSessionId, 'logout');
  }

  sendOk(res);
});
