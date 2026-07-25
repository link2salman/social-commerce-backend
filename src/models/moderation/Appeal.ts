import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import {
  APPEAL_TARGET_TYPES,
  APPEAL_STATUSES,
  type AppealTargetType,
  type AppealStatus,
} from '@constants/enums';

// A user's appeal of a moderation action. Polymorphic target (target_id has no
// FK — mirrors `reports`): 'user' → the appellant's own suspension, 'video' →
// their removed clip. `status` + reviewed_* carry the review workflow, granting
// an appeal reverses the original action (appealService.resolveAppeal).
export interface AppealAttributes {
  appeal_id: string;
  user_id: string;
  target_type: AppealTargetType;
  target_id: string;
  reason: string;
  status: AppealStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  resolution_note: string | null;
  created_at: Date;
}

export type AppealCreationAttributes = Optional<
  AppealAttributes,
  | 'appeal_id'
  | 'status'
  | 'reviewed_by'
  | 'reviewed_at'
  | 'resolution_note'
  | 'created_at'
>;

export interface AppealModel
  extends Model<AppealAttributes, AppealCreationAttributes>,
    AppealAttributes {}

const Appeal = sequelize.define<AppealModel>(
  'Appeal',
  {
    appeal_id: {
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
    target_type: {
      type: DataTypes.ENUM(...APPEAL_TARGET_TYPES),
      allowNull: false,
    },
    target_id: { type: DataTypes.UUID, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    status: {
      type: DataTypes.ENUM(...APPEAL_STATUSES),
      allowNull: false,
      defaultValue: 'pending',
    },
    reviewed_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    reviewed_at: { type: DataTypes.DATE, allowNull: true },
    resolution_note: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.Appeal,
    timestamps: false,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['target_type', 'target_id'] },
    ],
  }
);

export default Appeal;
