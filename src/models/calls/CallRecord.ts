import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import {
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  type CallDirection,
  type CallOutcome,
} from '@constants/enums';

/**
 * One participant, frozen at call time. Identical in spirit to the peer_*
 * columns: the client hands it back to ring that person again, so it must not
 * drift if they later rename.
 *
 * Stored snake_case, matching the wire (`CallPeerJSON`). Keeping the JSONB in a
 * different casing than the response would mean a silent remap in the serializer
 * AND in the validator that accepts it back from the client — two places to
 * forget. Existing rows are rewritten by the
 * `jsonb-snake-case` migration.
 */
export interface CallParticipantSnapshot {
  id: string;
  username: string;
  avatar_url: string | null;
}

/**
 * A call-log entry owned by `owner_id`, in one of two shapes:
 *
 *  - 1:1   (`is_group` false) — peer_id/peer_username/peer_avatar_url carry the
 *    single other side; `participants` is [].
 *  - group (`is_group` true)  — peer_* are null; `participants` carries a frozen
 *    snapshot of everyone rung, excluding the owner.
 *
 * Exactly one shape is populated, enforced by a CHECK constraint in the DB
 * (`call_records_peer_xor_group`) as well as by the request validator.
 */
export interface CallRecordAttributes {
  call_id: string;
  owner_id: string;
  peer_id: string | null;
  peer_username: string | null;
  peer_avatar_url: string | null;
  is_group: boolean;
  participants: CallParticipantSnapshot[];
  direction: CallDirection;
  is_video: boolean;
  outcome: CallOutcome;
  started_at: Date;
  duration_sec: number;
  created_at: Date;
}

export type CallRecordCreationAttributes = Optional<
  CallRecordAttributes,
  | 'call_id'
  | 'peer_id'
  | 'peer_username'
  | 'peer_avatar_url'
  | 'is_group'
  | 'participants'
  | 'is_video'
  | 'duration_sec'
  | 'created_at'
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
    // Null on a group row, where `participants` carries the snapshots instead.
    peer_id: { type: DataTypes.UUID, allowNull: true },
    peer_username: { type: DataTypes.STRING(24), allowNull: true },
    peer_avatar_url: { type: DataTypes.TEXT, allowNull: true },
    is_group: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // Frozen snapshots of everyone rung, excluding the owner. [] on a 1:1 row.
    participants: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
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
