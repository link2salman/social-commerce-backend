import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import {
  REPORT_TARGET_TYPES,
  REPORT_STATUSES,
  type ReportTargetType,
  type ReportStatus,
} from '@constants/enums';

// A user report against a video, user, or comment. Polymorphic target
// (target_id has no FK) — the moderation service resolves it by type. `status`
// and the reviewed_* columns carry the review workflow.
export interface ReportAttributes {
  report_id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
  status: ReportStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  resolution_note: string | null;
  created_at: Date;
}

export type ReportCreationAttributes = Optional<
  ReportAttributes,
  | 'report_id'
  | 'status'
  | 'reviewed_by'
  | 'reviewed_at'
  | 'resolution_note'
  | 'created_at'
>;

export interface ReportModel
  extends Model<ReportAttributes, ReportCreationAttributes>,
    ReportAttributes {}

const Report = sequelize.define<ReportModel>(
  'Report',
  {
    report_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    reporter_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    target_type: {
      type: DataTypes.ENUM(...REPORT_TARGET_TYPES),
      allowNull: false,
    },
    target_id: { type: DataTypes.UUID, allowNull: false },
    reason: { type: DataTypes.STRING(120), allowNull: false },
    status: {
      type: DataTypes.ENUM(...REPORT_STATUSES),
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
    tableName: tableNames.Report,
    timestamps: false,
    indexes: [
      { fields: ['target_type', 'target_id'] },
      { fields: ['reporter_id'] },
    ],
  }
);

export default Report;
