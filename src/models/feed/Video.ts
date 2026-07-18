import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// Denormalized counters live on the row (feed is the hot read path — we never
// COUNT per card). The engagement/comment services keep them coherent inside
// the same transaction that writes the underlying row.
//
// `hls_url` is a misnomer kept for compatibility: it holds the playback URL,
// which in practice is a progressive MP4 (no transcode pipeline exists). It is
// not renamed because the app's Zod schema pins the `hlsUrl` wire field — see
// the write site in services/videoService.ts.
export interface VideoAttributes {
  video_id: string;
  author_id: string;
  hls_url: string;
  thumbnail_url: string;
  caption: string;
  duration_ms: number;
  sound_name: string | null;
  // The camera filter the clip was shot with. Write-only today — see the note
  // at the write site in services/videoService.ts.
  filter_id: string | null;
  like_count: number;
  dislike_count: number;
  comment_count: number;
  share_count: number;
  save_count: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export type VideoCreationAttributes = Optional<
  VideoAttributes,
  | 'video_id'
  | 'caption'
  | 'sound_name'
  | 'filter_id'
  | 'like_count'
  | 'dislike_count'
  | 'comment_count'
  | 'share_count'
  | 'save_count'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
>;

export interface VideoModel
  extends Model<VideoAttributes, VideoCreationAttributes>,
    VideoAttributes {}

const counter = () => ({
  type: DataTypes.INTEGER,
  allowNull: false,
  defaultValue: 0,
  validate: { min: 0 },
});

const Video = sequelize.define<VideoModel>(
  'Video',
  {
    video_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    author_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    hls_url: { type: DataTypes.TEXT, allowNull: false },
    thumbnail_url: { type: DataTypes.TEXT, allowNull: false },
    caption: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    duration_ms: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1 },
    },
    sound_name: { type: DataTypes.STRING(160), allowNull: true },
    filter_id: { type: DataTypes.STRING(32), allowNull: true },
    like_count: counter(),
    dislike_count: counter(),
    comment_count: counter(),
    share_count: counter(),
    save_count: counter(),
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    deleted_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  },
  {
    tableName: tableNames.Video,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [
      { fields: ['author_id'] },
      // Feed keyset pagination sorts (created_at DESC, video_id DESC).
      { fields: ['created_at', 'video_id'] },
    ],
  }
);

export default Video;
