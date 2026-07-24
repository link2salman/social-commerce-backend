import { Op } from 'sequelize';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt } from 'crypto';
import {
  ConflictError,
  UnauthorizedError,
  BadRequestError,
} from '@middlewares/error';
import User, { type UserModel } from '@models/user/User';
import PasswordResetCode from '@models/user/PasswordResetCode';
import { sendEmail } from '@services/emailService';
import { revokeAllUserSessions } from '@services/authSessionService';
import type { LoginBody, SignupBody } from '@validators/authValidators';

// Create a new account. Username/email uniqueness is enforced by partial unique
// indexes on live rows (see migration); we also pre-check for a friendly 409
// rather than surfacing a raw constraint error.
//
// The 409 message is deliberately generic ("email or username"): distinct
// "email exists" vs "username taken" messages are an account-enumeration oracle
// (an attacker probes which emails are registered). Login and forgot-password
// are generic for the same reason; signup now matches them.
export const signup = async (input: SignupBody): Promise<UserModel> => {
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();

  const clash = await User.findOne({
    where: { [Op.or]: [{ email }, { username }] },
    attributes: ['user_id'],
  });
  if (clash) {
    throw new ConflictError('That email or username is already taken');
  }

  return User.create({
    email,
    username,
    password_hash: input.password, // hashed by the model's beforeCreate hook
    display_name: username,
    email_verified: false,
  });
};

// A valid bcrypt hash of a throwaway secret. When login is attempted for an
// unknown email we still run one bcrypt.compare against this so the response
// time doesn't reveal whether the email exists (a hit runs bcrypt; a miss that
// returned early would be measurably faster — a timing enumeration oracle).
const TIMING_EQUALIZER_HASH = bcrypt.hashSync('timing-equalizer', 10);

// Verify credentials. The same generic message for "no such user" and "wrong
// password" so the endpoint doesn't reveal which emails are registered.
export const login = async (input: LoginBody): Promise<UserModel> => {
  const email = input.email.trim().toLowerCase();
  const user = await User.findOne({ where: { email } });
  if (!user) {
    await bcrypt.compare(input.password, TIMING_EQUALIZER_HASH);
    throw new UnauthorizedError('Invalid email or password');
  }
  if (!(await user.matchPassword(input.password))) {
    throw new UnauthorizedError('Invalid email or password');
  }
  if (!user.is_active) {
    throw new UnauthorizedError('This account is inactive');
  }
  return user;
};

// ── Password reset (email OTP) ───────────────────────────────────────────────
const RESET_TTL_MS = 10 * 60 * 1000;
const hashResetCode = (code: string): string =>
  createHash('sha256').update(code).digest('hex');

// Step 1: email a one-time 6-digit code. Returns void regardless of whether the
// email exists — the endpoint must not reveal which emails are registered. If
// SMTP isn't configured, the code is generated but simply not delivered.
export const requestPasswordReset = async (email: string): Promise<void> => {
  const user = await User.findOne({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user) return;

  // Only the newest code is valid — clear any prior ones.
  await PasswordResetCode.destroy({ where: { user_id: user.user_id } });

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await PasswordResetCode.create({
    user_id: user.user_id,
    code_hash: hashResetCode(code),
    expires_at: new Date(Date.now() + RESET_TTL_MS),
  });

  await sendEmail({
    to: user.email,
    subject: 'Your password reset code',
    text: `Your Social Commerce password reset code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
  });
};

// A live code tolerates this many wrong guesses before it is burned. Caps the
// 6-digit (10⁶) brute-force surface to a handful of tries per issued code, so a
// rotating-IP attacker can't out-run the per-IP rate limiter.
const MAX_RESET_ATTEMPTS = 5;

// Step 2: verify the code and set a new password (the model hook re-hashes it).
// A wrong guess is charged against the newest live code; once it crosses the
// attempt cap the code is burned. On success we also revoke every session and
// access token — a reset must evict an attacker who already holds a token.
export const resetPassword = async (
  email: string,
  code: string,
  newPassword: string
): Promise<void> => {
  const user = await User.findOne({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user) throw new BadRequestError('Invalid or expired code.');

  // Load the newest live (unused, unexpired) code and verify in-app, so a wrong
  // guess is attributable to a specific code row and can be counted. (Prior
  // codes are purged when a new one is issued, so there is normally just one.)
  const row = await PasswordResetCode.findOne({
    where: { user_id: user.user_id, used_at: null },
    order: [['created_at', 'DESC']],
  });
  if (!row || row.expires_at.getTime() < Date.now()) {
    throw new BadRequestError('Invalid or expired code.');
  }
  if (row.attempts >= MAX_RESET_ATTEMPTS) {
    await row.update({ used_at: new Date() }); // exhausted — burn it
    throw new BadRequestError('Invalid or expired code.');
  }

  if (row.code_hash !== hashResetCode(code)) {
    await row.increment('attempts', { by: 1 });
    await row.reload();
    if (row.attempts >= MAX_RESET_ATTEMPTS) {
      await row.update({ used_at: new Date() }); // burn on reaching the cap
    }
    throw new BadRequestError('Invalid or expired code.');
  }

  await row.update({ used_at: new Date() });
  user.password_hash = newPassword; // hashed by the model's beforeUpdate hook
  await user.save();

  // Evict any session/token an attacker may already hold: revoking the sessions
  // also kills live access tokens, which are checked against session state on
  // every request (assertAccessSessionActive).
  await revokeAllUserSessions(user.user_id, 'password_change');
};
