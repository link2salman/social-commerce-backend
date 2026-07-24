import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// A short-lived one-time code for password reset. Only the SHA-256 hash of the
// 6-digit code is stored (never the code itself). Consumed on use, expired after
// a few minutes; prior codes for a user are purged when a new one is requested.
export interface PasswordResetCodeAttributes {
  id: string;
  user_id: string;
  code_hash: string;
  expires_at: Date;
  used_at: Date | null;
  // Failed verification attempts against this live code. The service burns the
  // code once this crosses the cap, so the 6-digit space can't be brute-forced.
  attempts: number;
  created_at: Date;
}

export type PasswordResetCodeCreationAttributes = Optional<
  PasswordResetCodeAttributes,
  'id' | 'used_at' | 'attempts' | 'created_at'
>;

export interface PasswordResetCodeModel
  extends Model<
      PasswordResetCodeAttributes,
      PasswordResetCodeCreationAttributes
    >,
    PasswordResetCodeAttributes {}

const PasswordResetCode = sequelize.define<PasswordResetCodeModel>(
  'PasswordResetCode',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    code_hash: { type: DataTypes.STRING(64), allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    used_at: { type: DataTypes.DATE, allowNull: true },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.PasswordResetCode,
    timestamps: false,
    indexes: [{ fields: ['user_id'] }],
  }
);

export default PasswordResetCode;
