import { Op } from 'sequelize';
import { createHash, randomInt } from 'crypto';
import {
  ConflictError,
  UnauthorizedError,
  BadRequestError,
} from '@middlewares/error';
import User, { type UserModel } from '@models/user/User';
import PasswordResetCode from '@models/user/PasswordResetCode';
import { sendEmail } from '@services/emailService';
import type { LoginBody, SignupBody } from '@validators/authValidators';

// Create a new account. Username/email uniqueness is enforced by partial unique
// indexes on live rows (see migration); we also pre-check for a friendly 409
// rather than surfacing a raw constraint error.
export const signup = async (input: SignupBody): Promise<UserModel> => {
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();

  const clash = await User.findOne({
    where: { [Op.or]: [{ email }, { username }] },
    attributes: ['user_id', 'email', 'username'],
  });
  if (clash) {
    throw new ConflictError(
      clash.email === email
        ? 'An account with this email already exists'
        : 'That username is taken'
    );
  }

  return User.create({
    email,
    username,
    password_hash: input.password, // hashed by the model's beforeCreate hook
    display_name: username,
    email_verified: false,
  });
};

// Verify credentials. The same generic message for "no such user" and "wrong
// password" so the endpoint doesn't reveal which emails are registered.
export const login = async (input: LoginBody): Promise<UserModel> => {
  const email = input.email.trim().toLowerCase();
  const user = await User.findOne({ where: { email } });
  if (!user || !(await user.matchPassword(input.password))) {
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

// Step 2: verify the code and set a new password (the model hook re-hashes it).
export const resetPassword = async (
  email: string,
  code: string,
  newPassword: string
): Promise<void> => {
  const user = await User.findOne({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user) throw new BadRequestError('Invalid or expired code.');

  const row = await PasswordResetCode.findOne({
    where: {
      user_id: user.user_id,
      code_hash: hashResetCode(code),
      used_at: null,
    },
    order: [['created_at', 'DESC']],
  });
  if (!row || row.expires_at.getTime() < Date.now()) {
    throw new BadRequestError('Invalid or expired code.');
  }

  await row.update({ used_at: new Date() });
  user.password_hash = newPassword; // hashed by the model's beforeUpdate hook
  await user.save();
};
