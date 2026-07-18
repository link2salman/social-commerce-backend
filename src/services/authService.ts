import { Op } from 'sequelize';
import { ConflictError, UnauthorizedError } from '@middlewares/error';
import User, { type UserModel } from '@models/user/User';
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
