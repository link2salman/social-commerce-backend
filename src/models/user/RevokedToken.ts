// JWT blacklist — persists invalidated access tokens so logout / password
// change take effect before the token's natural expiry.
import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import {
  TOKEN_REVOCATION_REASONS,
  type TokenRevocationReason,
} from '@constants/enums';

export interface RevokedTokenAttributes {
  token_id: string;
  /** SHA-256 hex of the raw JWT — never store the token itself. */
  token_hash: string;
  user_id: string | null;
  /** Mirrors the JWT exp claim; a cleanup job prunes expired rows. */
  expires_at: Date;
  revoked_at: Date;
  reason: TokenRevocationReason | null;
}

export type RevokedTokenCreationAttributes = Optional<
  RevokedTokenAttributes,
  'token_id' | 'user_id' | 'revoked_at' | 'reason'
>;

export interface RevokedTokenModel
  extends Model<RevokedTokenAttributes, RevokedTokenCreationAttributes>,
    RevokedTokenAttributes {}

const RevokedToken = sequelize.define<RevokedTokenModel>(
  'RevokedToken',
  {
    token_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    token_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    reason: {
      type: DataTypes.STRING(50),
      allowNull: true,
      validate: { isIn: [[...TOKEN_REVOCATION_REASONS]] },
    },
  },
  {
    tableName: tableNames.RevokedToken,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['token_hash'] },
      { fields: ['user_id'] },
      { fields: ['expires_at'] },
    ],
  }
);

export default RevokedToken;
