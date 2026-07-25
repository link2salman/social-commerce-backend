import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import { POST_MEDIA_TYPES, type PostMediaType } from '@constants/enums';

// A media attachment on a post — an image OR a video. The media already lives in
// storage (the client uploaded it via the signed-URL route), so this is just the
// URL + its kind + position in the carousel. A video carries a `thumbnail_url`
// (poster) and `duration_ms`; both are null for images. Ordered by `position`.
export interface PostMediaAttributes {
  post_media_id: string;
  post_id: string;
  media_type: PostMediaType;
  url: string;
  thumbnail_url: string | null;
  duration_ms: number | null;
  position: number;
  created_at: Date;
}

export type PostMediaCreationAttributes = Optional<
  PostMediaAttributes,
  'post_media_id' | 'media_type' | 'thumbnail_url' | 'duration_ms' | 'created_at'
>;

export interface PostMediaModel
  extends Model<PostMediaAttributes, PostMediaCreationAttributes>,
    PostMediaAttributes {}

const PostMedia = sequelize.define<PostMediaModel>(
  'PostMedia',
  {
    post_media_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    post_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Post, key: 'post_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    media_type: {
      type: DataTypes.ENUM(...POST_MEDIA_TYPES),
      allowNull: false,
      defaultValue: 'image',
    },
    url: { type: DataTypes.TEXT, allowNull: false },
    thumbnail_url: { type: DataTypes.TEXT, allowNull: true },
    duration_ms: { type: DataTypes.INTEGER, allowNull: true },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.PostMedia,
    timestamps: false,
    indexes: [{ fields: ['post_id', 'position'] }],
  }
);

export default PostMedia;
