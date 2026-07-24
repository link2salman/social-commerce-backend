import jwt from 'jsonwebtoken';
import { api, path } from '../helpers/app';
import { registerUser, uniqueUsername, bearer, DEFAULT_PASSWORD } from '../helpers/factories';
import UserSession from '@models/user/UserSession';
import RevokedToken from '@models/user/RevokedToken';
import { hashToken } from '@middlewares/auth';

// Email delivery is an env-gated external integration (SMTP_HOST unset → no-op),
// so the reset CODE never leaves the process in a test run. Mocking the seam
// lets the password-reset test drive the REAL end-to-end path — request a code,
// read the very code the service generated, redeem it — instead of reaching into
// the database and forging a hash.
jest.mock('@services/emailService', () => ({
  __esModule: true,
  sendEmail: jest.fn().mockResolvedValue(true),
  isEmailConfigured: jest.fn().mockReturnValue(true),
}));
import { sendEmail } from '@services/emailService';

const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;

/** Pull the 6-digit OTP out of the email the service just "sent". */
const capturedResetCode = (): string => {
  const calls = mockedSendEmail.mock.calls;
  const last = calls[calls.length - 1]?.[0];
  const match = last?.text.match(/\b(\d{6})\b/);
  if (!match?.[1]) {
    throw new Error(`no reset code in email: ${JSON.stringify(last)}`);
  }
  return match[1];
};

describe('auth', () => {
  describe('POST /auth/signup', () => {
    it('creates an account and returns the raw Session shape', async () => {
      const username = uniqueUsername();
      const res = await api()
        .post(path('/auth/signup'))
        .send({ username, email: `${username}@example.test`, password: DEFAULT_PASSWORD });

      expect(res.status).toBe(201);
      // The client Zod-parses the WHOLE body as SessionSchema.
      expect(Object.keys(res.body).sort()).toEqual([
        'accessToken',
        'refreshToken',
        'userId',
      ]);
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');

      // The access token is a JWT carrying {userId, jti, sessionId}.
      const decoded = jwt.decode(res.body.accessToken) as Record<string, unknown>;
      expect(decoded.userId).toBe(res.body.userId);
      expect(typeof decoded.jti).toBe('string');
      expect(typeof decoded.sessionId).toBe('string');

      // A device session was persisted, and the refresh token is stored HASHED —
      // the DB must never hold a usable credential.
      const session = await UserSession.findByPk(decoded.sessionId as string);
      expect(session).not.toBeNull();
      expect(session!.user_id).toBe(res.body.userId);
      expect(session!.refresh_token_hash).not.toContain(res.body.refreshToken);
      expect(session!.revoked_at).toBeNull();
    });

    // The conflict message is deliberately generic: it must NOT reveal whether
    // it was the email or the username that clashed, or signup becomes an
    // account-enumeration oracle. Both cases return the same 409 + message.
    it('rejects a duplicate email with a generic 409 (no enumeration)', async () => {
      const existing = await registerUser();
      const res = await api().post(path('/auth/signup')).send({
        username: uniqueUsername(),
        email: existing.email,
        password: DEFAULT_PASSWORD,
      });

      expect(res.status).toBe(409);
      // Same text as the username clash below — the response can't be used to
      // tell "email is registered" from "username is registered".
      expect(res.body.message).toBe('That email or username is already taken');
    });

    it('rejects a duplicate username with the SAME generic 409', async () => {
      const existing = await registerUser();
      const username = uniqueUsername();
      const res = await api().post(path('/auth/signup')).send({
        username: existing.username,
        email: `${username}@example.test`,
        password: DEFAULT_PASSWORD,
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('That email or username is already taken');
    });

    it.each([
      ['a malformed email', { username: 'validname', email: 'not-an-email', password: DEFAULT_PASSWORD }],
      ['a short password', { username: 'validname', email: 'a@example.test', password: 'short' }],
      ['an uppercase username', { username: 'NotLowercase', email: 'b@example.test', password: DEFAULT_PASSWORD }],
      ['a 2-character username', { username: 'ab', email: 'c@example.test', password: DEFAULT_PASSWORD }],
      ['a missing password', { username: 'validname', email: 'd@example.test' }],
    ])('rejects %s with 400 and field errors', async (_label, body) => {
      const res = await api().post(path('/auth/signup')).send(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(res.body.errors[0]).toEqual({
        field: expect.any(String),
        message: expect.any(String),
      });
    });
  });

  describe('POST /auth/login', () => {
    it('returns a NEW session for valid credentials', async () => {
      const user = await registerUser();
      const res = await api()
        .post(path('/auth/login'))
        .send({ email: user.email, password: user.password });

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(user.id);
      // Logging in opens a second device session; it must not reuse the first.
      expect(res.body.refreshToken).not.toBe(user.refreshToken);
      expect(await UserSession.count({ where: { user_id: user.id } })).toBe(2);
    });

    it('is case-insensitive on the email', async () => {
      const user = await registerUser();
      const res = await api()
        .post(path('/auth/login'))
        .send({ email: user.email.toUpperCase(), password: user.password });

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(user.id);
    });

    it('rejects a wrong password with 401 and a non-committal message', async () => {
      const user = await registerUser();
      const res = await api()
        .post(path('/auth/login'))
        .send({ email: user.email, password: 'wrong-password-entirely' });

      expect(res.status).toBe(401);
      // Must not reveal whether the account exists.
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('rejects an unknown email with the SAME 401 message', async () => {
      const res = await api()
        .post(path('/auth/login'))
        .send({ email: 'nobody@example.test', password: DEFAULT_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token and issues a working access token', async () => {
      const user = await registerUser();
      const res = await api()
        .post(path('/auth/refresh'))
        .send({ refreshToken: user.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(user.id);
      expect(res.body.refreshToken).not.toBe(user.refreshToken);

      // Same device session, rotated — not a new session row.
      expect(await UserSession.count({ where: { user_id: user.id } })).toBe(1);
      const oldSessionId = user.refreshToken.split('.')[0];
      expect(res.body.refreshToken.split('.')[0]).toBe(oldSessionId);
      const session = await UserSession.findByPk(oldSessionId!);
      expect(session!.rotation_count).toBe(1);

      // The freshly-minted access token authenticates.
      const me = await api()
        .get(path(`/users/${user.id}`))
        .set('Authorization', `Bearer ${res.body.accessToken}`);
      expect(me.status).toBe(200);
    });

    it('REJECTS a reused (already-rotated) refresh token and kills the session', async () => {
      const user = await registerUser();

      const first = await api()
        .post(path('/auth/refresh'))
        .send({ refreshToken: user.refreshToken });
      expect(first.status).toBe(200);

      // Replaying the ORIGINAL token is the classic stolen-token signal.
      const replay = await api()
        .post(path('/auth/refresh'))
        .send({ refreshToken: user.refreshToken });

      expect(replay.status).toBe(401);
      expect(replay.body.message).toMatch(/already been rotated/i);

      // Reuse detection revokes the whole session, so the token the ATTACKER did
      // not have (the legitimately rotated one) is burned too.
      const sessionId = user.refreshToken.split('.')[0]!;
      const session = await UserSession.findByPk(sessionId);
      expect(session!.revoked_at).not.toBeNull();
      expect(session!.revoked_reason).toBe('refresh_reuse');

      const afterRevoke = await api()
        .post(path('/auth/refresh'))
        .send({ refreshToken: first.body.refreshToken });
      expect(afterRevoke.status).toBe(401);
    });

    it('rejects a structurally invalid refresh token with 401', async () => {
      const res = await api()
        .post(path('/auth/refresh'))
        .send({ refreshToken: 'not-a-real-token' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid refresh token');
    });

    it('rejects an unknown but well-formed refresh token with 401', async () => {
      const res = await api()
        .post(path('/auth/refresh'))
        .send({ refreshToken: '3f1e4b6a-7c9d-4e2f-8a1b-0c5d6e7f8a9b.deadbeef' });

      expect(res.status).toBe(401);
    });

    it('rejects a missing refreshToken with 400', async () => {
      const res = await api().post(path('/auth/refresh')).send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
    });
  });

  describe('POST /auth/logout', () => {
    it('blacklists the access token AND revokes the refresh session', async () => {
      const user = await registerUser();
      const sessionId = user.refreshToken.split('.')[0]!;

      // Sanity: the token works before logout.
      const before = await api()
        .get(path(`/users/${user.id}`))
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(before.status).toBe(200);

      const res = await api()
        .post(path('/auth/logout'))
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ refreshToken: user.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      // 1. The access token is blacklisted — stored as sha256, never in the clear.
      const revoked = await RevokedToken.findOne({
        where: { token_hash: hashToken(user.accessToken) },
      });
      expect(revoked).not.toBeNull();
      expect(revoked!.user_id).toBe(user.id);
      expect(revoked!.reason).toBe('logout');

      // 2. …and it no longer authenticates.
      const after = await api()
        .get(path(`/users/${user.id}`))
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(after.status).toBe(401);
      expect(after.body.message).toMatch(/revoked/i);

      // 3. The refresh session is revoked, so it cannot mint a replacement.
      const session = await UserSession.findByPk(sessionId);
      expect(session!.revoked_at).not.toBeNull();
      expect(session!.revoked_reason).toBe('logout');

      const refreshed = await api()
        .post(path('/auth/refresh'))
        .send({ refreshToken: user.refreshToken });
      expect(refreshed.status).toBe(401);
    });

    it('revokes the CURRENT session when no refreshToken is supplied', async () => {
      const user = await registerUser();
      const sessionId = user.refreshToken.split('.')[0]!;

      const res = await api()
        .post(path('/auth/logout'))
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      const session = await UserSession.findByPk(sessionId);
      expect(session!.revoked_at).not.toBeNull();
    });

    it('requires authentication', async () => {
      const res = await api().post(path('/auth/logout'));

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/no token provided/i);
    });
  });

  describe('password reset', () => {
    it('emails a code that resets the password and invalidates the old one', async () => {
      const user = await registerUser();

      const forgot = await api()
        .post(path('/auth/forgot-password'))
        .send({ email: user.email });
      expect(forgot.status).toBe(200);
      expect(forgot.body).toEqual({ ok: true });
      expect(mockedSendEmail).toHaveBeenCalledTimes(1);

      const code = capturedResetCode();
      const newPassword = 'a-brand-new-password';

      const reset = await api()
        .post(path('/auth/reset-password'))
        .send({ email: user.email, code, password: newPassword });
      expect(reset.status).toBe(200);
      expect(reset.body).toEqual({ ok: true });

      // The new password works…
      const loginNew = await api()
        .post(path('/auth/login'))
        .send({ email: user.email, password: newPassword });
      expect(loginNew.status).toBe(200);

      // …and the old one does not.
      const loginOld = await api()
        .post(path('/auth/login'))
        .send({ email: user.email, password: user.password });
      expect(loginOld.status).toBe(401);
    });

    it('burns the code — a second redemption fails', async () => {
      const user = await registerUser();
      await api().post(path('/auth/forgot-password')).send({ email: user.email });
      const code = capturedResetCode();

      const first = await api()
        .post(path('/auth/reset-password'))
        .send({ email: user.email, code, password: 'first-new-password' });
      expect(first.status).toBe(200);

      const second = await api()
        .post(path('/auth/reset-password'))
        .send({ email: user.email, code, password: 'second-new-password' });
      expect(second.status).toBe(400);
      expect(second.body.message).toBe('Invalid or expired code.');
    });

    it('returns 200 for an unknown email without sending anything', async () => {
      const res = await api()
        .post(path('/auth/forgot-password'))
        .send({ email: 'ghost@example.test' });

      // Must not reveal which addresses have accounts.
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    it('rejects a wrong code with 400', async () => {
      const user = await registerUser();
      await api().post(path('/auth/forgot-password')).send({ email: user.email });
      const actual = capturedResetCode();
      const wrong = actual === '000000' ? '111111' : '000000';

      const res = await api()
        .post(path('/auth/reset-password'))
        .send({ email: user.email, code: wrong, password: 'another-password' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid or expired code.');
    });

    it('rejects a non-6-digit code with 400 before touching the database', async () => {
      const res = await api()
        .post(path('/auth/reset-password'))
        .send({ email: 'someone@example.test', code: 'abc', password: 'a-password' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
      expect(res.body.errors).toContainEqual({
        field: 'code',
        message: 'Enter the 6-digit code',
      });
    });

    it('EVICTS existing sessions and tokens on reset (kills a stolen token)', async () => {
      const user = await registerUser();
      const sessionId = user.refreshToken.split('.')[0]!;

      // The attacker holds this user's access + refresh token; the user resets.
      await api().post(path('/auth/forgot-password')).send({ email: user.email });
      const code = capturedResetCode();
      const reset = await api()
        .post(path('/auth/reset-password'))
        .send({ email: user.email, code, password: 'evict-the-attacker' });
      expect(reset.status).toBe(200);

      // The pre-reset session is revoked with the password-change reason…
      const session = await UserSession.findByPk(sessionId);
      expect(session!.revoked_at).not.toBeNull();
      expect(session!.revoked_reason).toBe('password_change');

      // …so the stolen refresh token can no longer rotate…
      const refresh = await api()
        .post(path('/auth/refresh'))
        .send({ refreshToken: user.refreshToken });
      expect(refresh.status).toBe(401);

      // …and the stolen access token is rejected on its next request.
      const afterReset = await api()
        .get(path('/orders'))
        .set('Authorization', bearer(user));
      expect(afterReset.status).toBe(401);
    });

    it('burns the code after too many wrong guesses (brute-force cap)', async () => {
      const user = await registerUser();
      await api().post(path('/auth/forgot-password')).send({ email: user.email });
      const code = capturedResetCode();
      const wrong = code === '000000' ? '111111' : '000000';

      // Five wrong guesses exhaust the code's attempt budget.
      for (let i = 0; i < 5; i += 1) {
        const bad = await api()
          .post(path('/auth/reset-password'))
          .send({ email: user.email, code: wrong, password: 'not-the-real-pw' });
        expect(bad.status).toBe(400);
      }

      // Even the CORRECT code is now dead — the row was burned.
      const correct = await api()
        .post(path('/auth/reset-password'))
        .send({ email: user.email, code, password: 'too-late-attacker' });
      expect(correct.status).toBe(400);
      expect(correct.body.message).toBe('Invalid or expired code.');

      // The reset never completed, so the original password still works.
      const login = await api()
        .post(path('/auth/login'))
        .send({ email: user.email, password: user.password });
      expect(login.status).toBe(200);
    });
  });

  describe('the `protect` guard', () => {
    it('rejects a request with no Authorization header', async () => {
      const res = await api().get(path('/orders'));

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/no token provided/i);
    });

    it('rejects a garbage bearer token', async () => {
      const res = await api()
        .get(path('/orders'))
        .set('Authorization', 'Bearer not.a.jwt');

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid token/i);
    });

    it('rejects a token signed with the wrong secret', async () => {
      const forged = jwt.sign(
        { userId: '00000000-0000-4000-8000-000000000000', jti: 'x' },
        'not-the-real-secret'
      );
      const res = await api()
        .get(path('/orders'))
        .set('Authorization', `Bearer ${forged}`);

      expect(res.status).toBe(401);
    });

    it('rejects a validly-signed token whose device session was revoked', async () => {
      const user = await registerUser();
      const sessionId = user.refreshToken.split('.')[0]!;
      await UserSession.update(
        { revoked_at: new Date(), revoked_reason: 'admin_revoke' },
        { where: { session_id: sessionId } }
      );

      const res = await api()
        .get(path(`/users/${user.id}`))
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/session has been revoked/i);
    });

    it('rejects an expired access token', async () => {
      const user = await registerUser();
      const sessionId = user.refreshToken.split('.')[0]!;
      const expired = jwt.sign(
        { userId: user.id, jti: 'expired-token', sessionId },
        process.env.JWT_SECRET as string,
        { expiresIn: '-1s' }
      );

      const res = await api()
        .get(path(`/users/${user.id}`))
        .set('Authorization', `Bearer ${expired}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid token/i);
    });

    it('returns 403 (not 401) for a deactivated account', async () => {
      const user = await registerUser();
      const { default: User } = await import('@models/user/User');
      await User.update({ is_active: false }, { where: { user_id: user.id } });

      const res = await api()
        .get(path(`/users/${user.id}`))
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/inactive/i);
    });
  });
});
