import * as bcrypt from 'bcryptjs';
import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import { numberEnv } from '@utils/env';

// A social-commerce user: username + displayName profile (the mobile client's
// UserSchema), not the reference backend's first/last-name commerce customer.
export interface UserAttributes {
  user_id: string;
  username: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  is_active: boolean;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export type UserCreationAttributes = Optional<
  UserAttributes,
  | 'user_id'
  | 'password_hash'
  | 'avatar_url'
  | 'bio'
  | 'is_active'
  | 'email_verified'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
>;

export interface UserModel
  extends Model<UserAttributes, UserCreationAttributes>,
    UserAttributes {
  matchPassword(entered: string): Promise<boolean>;
}

const User = sequelize.define<UserModel>(
  'User',
  {
    user_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    username: {
      // Uniqueness enforced by a partial index on live rows (see migration) so
      // a soft-deleted account can be re-registered. Lowercased in a hook.
      type: DataTypes.STRING(24),
      allowNull: false,
      validate: {
        is: /^[a-z0-9_.]+$/,
        len: [3, 24],
      },
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: { isEmail: true },
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    display_name: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    avatar_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    email_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    deleted_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  },
  {
    tableName: tableNames.User,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    hooks: {
      beforeValidate: user => {
        if (user.username) user.username = user.username.trim().toLowerCase();
        if (user.email) user.email = user.email.trim().toLowerCase();
        if (!user.display_name && user.username) {
          user.display_name = user.username;
        }
      },
      beforeCreate: async user => {
        if (user.password_hash) {
          const salt = await bcrypt.genSalt(numberEnv('BCRYPT_ROUNDS', 10));
          user.password_hash = await bcrypt.hash(user.password_hash, salt);
        }
      },
      beforeUpdate: async user => {
        if (user.changed('password_hash') && user.password_hash) {
          const isHashed = /^\$2[aby]\$\d{2}\$.{53}$/.test(user.password_hash);
          if (!isHashed) {
            const salt = await bcrypt.genSalt(numberEnv('BCRYPT_ROUNDS', 10));
            user.password_hash = await bcrypt.hash(user.password_hash, salt);
          }
        }
      },
    },
  }
);

// Defense-in-depth: an accidental res.json(user) never leaks the hash. All
// client-facing output goes through the serializers, which build exact wire
// shapes and never touch this field.
(User as unknown as { prototype: UserModel }).prototype.toJSON = function () {
  const values = { ...(this as UserModel).get() } as Record<string, unknown>;
  delete values.password_hash;
  return values;
};

(User as unknown as { prototype: UserModel }).prototype.matchPassword =
  async function (entered: string): Promise<boolean> {
    if (!this.password_hash) return false;
    return bcrypt.compare(entered, this.password_hash);
  };

export default User;
