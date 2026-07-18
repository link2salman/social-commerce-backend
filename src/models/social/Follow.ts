import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// Directional follow graph. `follower_id` follows `followee_id`. Distinct from
// friendship (a separate, symmetric relationship — see FriendRequest).
export interface FollowAttributes {
  follow_id: string;
  follower_id: string;
  followee_id: string;
  created_at: Date;
}

export type FollowCreationAttributes = Optional<
  FollowAttributes,
  'follow_id' | 'created_at'
>;

export interface FollowModel
  extends Model<FollowAttributes, FollowCreationAttributes>,
    FollowAttributes {}

const Follow = sequelize.define<FollowModel>(
  'Follow',
  {
    follow_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    follower_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    followee_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.Follow,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['follower_id', 'followee_id'] },
      { fields: ['followee_id'] },
      { fields: ['follower_id', 'created_at'] },
    ],
  }
);

export default Follow;
