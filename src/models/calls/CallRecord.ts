import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import {
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  type CallDirection,
  type CallOutcome,
} from '@constants/enums';

// A 1:1 call-log entry owned by `owner_id`. The peer's identity is a frozen
// snapshot (peer_username/avatar) — the client hands it back to ring that peer
// again, so it must not drift if the peer later renames.
export interface CallRecordAttributes {
  call_id: string;
  owner_id: string;
  peer_id: string;
  peer_username: string;
  peer_avatar_url: string | null;
  direction: CallDirection;
  is_video: boolean;
  outcome: CallOutcome;
  started_at: Date;
  duration_sec: number;
  created_at: Date;
}

export type CallRecordCreationAttributes = Optional<
  CallRecordAttributes,
  'call_id' | 'peer_avatar_url' | 'is_video' | 'duration_sec' | 'created_at'
>;

export interface CallRecordModel
  extends Model<CallRecordAttributes, CallRecordCreationAttributes>,
    CallRecordAttributes {}

const CallRecord = sequelize.define<CallRecordModel>(
  'CallRecord',
  {
    call_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    owner_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    // Frozen snapshot of the peer's user id (no FK — historical record).
    peer_id: { type: DataTypes.UUID, allowNull: false },
    peer_username: { type: DataTypes.STRING(24), allowNull: false },
    peer_avatar_url: { type: DataTypes.TEXT, allowNull: true },
    direction: { type: DataTypes.ENUM(...CALL_DIRECTIONS), allowNull: false },
    is_video: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    outcome: { type: DataTypes.ENUM(...CALL_OUTCOMES), allowNull: false },
    started_at: { type: DataTypes.DATE, allowNull: false },
    duration_sec: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.CallRecord,
    timestamps: false,
    indexes: [{ fields: ['owner_id', 'started_at'] }],
  }
);

export default CallRecord;
