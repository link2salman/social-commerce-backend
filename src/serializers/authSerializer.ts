// The client's SessionSchema — the exact, unwrapped body login/signup/refresh
// return. Identical shape for all three (auth.schema.ts).
export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export const toSession = (
  userId: string,
  tokens: { accessToken: string; refreshToken: string }
): SessionResponse => ({
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
  userId,
});
