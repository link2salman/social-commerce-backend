// The client's SessionSchema — what login/signup/refresh return under the
// envelope's `data`. Identical shape for all three (auth.schema.ts).
//
// Wire keys are snake_case. The `tokens` argument is internal (it comes straight
// off generateAccessToken / authSessionService) and stays camelCase.
export interface SessionResponse {
  access_token: string;
  refresh_token: string;
  user_id: string;
}

export const toSession = (
  userId: string,
  tokens: { accessToken: string; refreshToken: string }
): SessionResponse => ({
  access_token: tokens.accessToken,
  refresh_token: tokens.refreshToken,
  user_id: userId,
});
