import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import { DEVICE_PLATFORMS, type DevicePlatform } from '@constants/enums';

// One row per (device push token). The token is the FCM registration token the
// app obtains from firebase messaging; it's unique (a device re-registering
// upserts). Owned by the user who was logged in when it registered.
export interface DeviceTokenAttributes {
  id: string;
  user_id: string;
  token: string;
  platform: DevicePlatform;
  created_at: Date;
  updated_at: Date;
}

export type DeviceTokenCreationAttributes = Optional<
  DeviceTokenAttributes,
  'id' | 'created_at' | 'updated_at'
>;

export interface DeviceTokenModel
  extends Model<DeviceTokenAttributes, DeviceTokenCreationAttributes>,
    DeviceTokenAttributes {}

const DeviceToken = sequelize.define<DeviceTokenModel>(
  'DeviceToken',
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
    token: { type: DataTypes.TEXT, allowNull: false, unique: true },
    platform: {
      type: DataTypes.ENUM(...DEVICE_PLATFORMS),
      allowNull: false,
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.DeviceToken,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [{ fields: ['user_id'] }],
  }
);

export default DeviceToken;
