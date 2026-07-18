import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import {
  FRIEND_REQUEST_STATUSES,
  type FriendRequestStatus,
} from '@constants/enums';

// One row per (requester, addressee) pair. The viewer-facing `friendStatus`
// enum ('none'|'outgoing'|'incoming'|'friends') is DERIVED from this row
// relative to the viewer (see socialService).
export interface FriendRequestAttributes {
  request_id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendRequestStatus;
  created_at: Date;
  updated_at: Date;
}

export type FriendRequestCreationAttributes = Optional<
  FriendRequestAttributes,
  'request_id' | 'status' | 'created_at' | 'updated_at'
>;

export interface FriendRequestModel
  extends Model<FriendRequestAttributes, FriendRequestCreationAttributes>,
    FriendRequestAttributes {}

const FriendRequest = sequelize.define<FriendRequestModel>(
  'FriendRequest',
  {
    request_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    requester_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    addressee_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    status: {
      type: DataTypes.ENUM(...FRIEND_REQUEST_STATUSES),
      allowNull: false,
      defaultValue: 'pending',
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.FriendRequest,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { unique: true, fields: ['requester_id', 'addressee_id'] },
      { fields: ['addressee_id', 'status'] },
    ],
  }
);

export default FriendRequest;
