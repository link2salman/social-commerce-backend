import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import { ENGAGEMENT_TYPES, type EngagementType } from '@constants/enums';

// The Post equivalent of Engagement — one row per (user, post, type). Reuses the
// same ENGAGEMENT_TYPES vocabulary as videos: like/dislike are mutually exclusive
// (postEngagementService enforces it), save/bookmark/favorite are independent
// lists. The post's denormalized counters are kept in sync alongside writes here.
export interface PostEngagementAttributes {
  post_engagement_id: string;
  user_id: string;
  post_id: string;
  type: EngagementType;
  created_at: Date;
}

export type PostEngagementCreationAttributes = Optional<
  PostEngagementAttributes,
  'post_engagement_id' | 'created_at'
>;

export interface PostEngagementModel
  extends Model<PostEngagementAttributes, PostEngagementCreationAttributes>,
    PostEngagementAttributes {}

const PostEngagement = sequelize.define<PostEngagementModel>(
  'PostEngagement',
  {
    post_engagement_id: {
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
    post_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Post, key: 'post_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    type: {
      type: DataTypes.ENUM(...ENGAGEMENT_TYPES),
      allowNull: false,
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.PostEngagement,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['user_id', 'post_id', 'type'] },
      { fields: ['post_id', 'type'] },
      { fields: ['user_id', 'type'] },
    ],
  }
);

export default PostEngagement;
