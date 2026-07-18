import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

export interface UserSessionDeviceMetadata {
  user_agent: string | null;
  ip_address: string | null;
  device_type: string | null;
  device_label: string | null;
}

export interface UserSessionAttributes {
  session_id: string;
  user_id: string;
  refresh_token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  device_type: string | null;
  device_label: string | null;
  device_metadata: UserSessionDeviceMetadata;
  last_used_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  rotation_count: number;
  created_at: Date;
  updated_at: Date;
}

export type UserSessionCreationAttributes = Optional<
  UserSessionAttributes,
  | 'session_id'
  | 'user_agent'
  | 'ip_address'
  | 'device_type'
  | 'device_label'
  | 'device_metadata'
  | 'last_used_at'
  | 'revoked_at'
  | 'revoked_reason'
  | 'rotation_count'
  | 'created_at'
  | 'updated_at'
>;

export interface UserSessionModel
  extends Model<UserSessionAttributes, UserSessionCreationAttributes>,
    UserSessionAttributes {
  isRevoked(): boolean;
  isExpired(now?: Date): boolean;
}

const UserSession = sequelize.define<UserSessionModel>(
  'UserSession',
  {
    session_id: {
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
    refresh_token_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      validate: { is: /^[0-9a-f]{64}$/i },
    },
    user_agent: { type: DataTypes.TEXT, allowNull: true },
    ip_address: { type: DataTypes.STRING(45), allowNull: true },
    device_type: { type: DataTypes.STRING(50), allowNull: true },
    device_label: { type: DataTypes.STRING(120), allowNull: true },
    device_metadata: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    last_used_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    revoked_reason: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: null,
    },
    rotation_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: tableNames.UserSession,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { unique: true, fields: ['refresh_token_hash'] },
      { fields: ['user_id'] },
      { fields: ['expires_at'] },
      { fields: ['user_id', 'revoked_at', 'expires_at'] },
    ],
  }
);

(UserSession as unknown as { prototype: UserSessionModel }).prototype.isRevoked =
  function (): boolean {
    return this.revoked_at !== null;
  };

(UserSession as unknown as { prototype: UserSessionModel }).prototype.isExpired =
  function (now = new Date()): boolean {
    return this.expires_at.getTime() <= now.getTime();
  };

export default UserSession;
