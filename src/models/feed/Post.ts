import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// An image/text post — the Instagram/Twitter-style content type, alongside the
// video pipeline (which is untouched). A post carries a `body` (nullable, may be
// empty when it's an image-only post) and 0..n ordered images (PostImage). The
// "must have body OR at least one image" rule is enforced in the validator and
// service; a DB CHECK is not expressive enough (images live in a child table).
//
// Denormalized counters live on the row exactly like Video — the feed is the hot
// read path and never COUNTs per card; postEngagementService / postCommentService
// keep them coherent inside the same transaction that writes the underlying row.
export interface PostAttributes {
  post_id: string;
  author_id: string;
  body: string;
  like_count: number;
  dislike_count: number;
  comment_count: number;
  share_count: number;
  save_count: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export type PostCreationAttributes = Optional<
  PostAttributes,
  | 'post_id'
  | 'body'
  | 'like_count'
  | 'dislike_count'
  | 'comment_count'
  | 'share_count'
  | 'save_count'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
>;

export interface PostModel
  extends Model<PostAttributes, PostCreationAttributes>,
    PostAttributes {}

const counter = () => ({
  type: DataTypes.INTEGER,
  allowNull: false,
  defaultValue: 0,
  validate: { min: 0 },
});

const Post = sequelize.define<PostModel>(
  'Post',
  {
    post_id: {
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
    body: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
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
    tableName: tableNames.Post,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    // Paranoid so a moderator's "remove content" is a reversible soft-delete —
    // the appeals flow restores it, exactly like Video.
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [
      { fields: ['author_id'] },
      // Feed keyset pagination sorts (created_at DESC, post_id DESC).
      { fields: ['created_at', 'post_id'] },
    ],
  }
);

export default Post;
