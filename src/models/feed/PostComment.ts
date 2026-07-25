import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// A post comment or reply — one shape, distinguished by parent_id. Threads are
// one level deep (a reply's parent is always a top-level comment; enforced in the
// service). Mirrors the video Comment model, re-pointed at posts. like_count is
// denormalized; replyCount is derived on read.
export interface PostCommentAttributes {
  post_comment_id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  like_count: number;
  created_at: Date;
}

export type PostCommentCreationAttributes = Optional<
  PostCommentAttributes,
  'post_comment_id' | 'parent_id' | 'like_count' | 'created_at'
>;

export interface PostCommentModel
  extends Model<PostCommentAttributes, PostCommentCreationAttributes>,
    PostCommentAttributes {}

const PostComment = sequelize.define<PostCommentModel>(
  'PostComment',
  {
    post_comment_id: {
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
    author_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    parent_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: tableNames.PostComment, key: 'post_comment_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    body: { type: DataTypes.TEXT, allowNull: false },
    like_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.PostComment,
    timestamps: false,
    indexes: [
      { fields: ['post_id', 'parent_id', 'created_at'] },
      { fields: ['parent_id'] },
    ],
  }
);

export default PostComment;
