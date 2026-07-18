import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import { ENGAGEMENT_TYPES, type EngagementType } from '@constants/enums';

// One row per (user, video, type). Like/dislike are mutually exclusive — the
// engagement service enforces that; save/bookmark/favorite are independent
// lists (product decision). The video's denormalized counters are kept in sync
// alongside inserts/deletes here.
export interface EngagementAttributes {
  engagement_id: string;
  user_id: string;
  video_id: string;
  type: EngagementType;
  created_at: Date;
}

export type EngagementCreationAttributes = Optional<
  EngagementAttributes,
  'engagement_id' | 'created_at'
>;

export interface EngagementModel
  extends Model<EngagementAttributes, EngagementCreationAttributes>,
    EngagementAttributes {}

const Engagement = sequelize.define<EngagementModel>(
  'Engagement',
  {
    engagement_id: {
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
    video_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Video, key: 'video_id' },
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
    tableName: tableNames.Engagement,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['user_id', 'video_id', 'type'] },
      { fields: ['video_id', 'type'] },
      { fields: ['user_id', 'type'] },
    ],
  }
);

export default Engagement;
