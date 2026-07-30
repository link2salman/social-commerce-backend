import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import {
  MEDIA_JOB_KINDS,
  MEDIA_JOB_STATUSES,
  type MediaJobKind,
  type MediaJobStatus,
} from '@constants/enums';

// One unit of background media work. See the migration for why this is a table
// rather than a broker, and services/mediaJobService for the claim protocol.
//
// `subject_id` is polymorphic on `kind` and has no association wired in
// models/index.ts — same as notifications' target. Resolve it in the handler.
export interface MediaJobAttributes {
  job_id: string;
  kind: MediaJobKind;
  subject_id: string;
  status: MediaJobStatus;
  attempts: number;
  /** Not claimable before this. Failed attempts push it out (backoff). */
  run_after: Date;
  /** When a worker took the row; null while pending. */
  locked_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export type MediaJobCreationAttributes = Optional<
  MediaJobAttributes,
  | 'job_id'
  | 'status'
  | 'attempts'
  | 'run_after'
  | 'locked_at'
  | 'last_error'
  | 'created_at'
  | 'updated_at'
>;

export interface MediaJobModel
  extends Model<MediaJobAttributes, MediaJobCreationAttributes>,
    MediaJobAttributes {}

const MediaJob = sequelize.define<MediaJobModel>(
  'MediaJob',
  {
    job_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    kind: { type: DataTypes.ENUM(...MEDIA_JOB_KINDS), allowNull: false },
    subject_id: { type: DataTypes.UUID, allowNull: false },
    status: {
      type: DataTypes.ENUM(...MEDIA_JOB_STATUSES),
      allowNull: false,
      defaultValue: 'pending',
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    // NO model-level default, deliberately — the column's Postgres default
    // (`NOW()`) fills it instead. `DataTypes.NOW` here would make Sequelize send a
    // timestamp from the *app's* clock, which `claimNext` then compares against
    // the *database's* `NOW()`. Even 1ms of skew between the two (measured on the
    // dev Docker Postgres: exactly 1ms) makes a job briefly unclaimable right
    // after it is enqueued — invisible in production behind a 5s poll, and a
    // genuine flake the moment anything claims immediately. Letting one clock
    // decide both sides removes the question.
    run_after: { type: DataTypes.DATE, allowNull: false },
    locked_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    last_error: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.MediaJob,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    // Not paranoid: a finished job is history worth keeping, and there is no
    // "deleted job" concept — see reapOldJobs in mediaJobService for retention.
    indexes: [{ fields: ['status', 'run_after'] }],
  }
);

export default MediaJob;
