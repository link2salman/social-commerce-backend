import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// One row per (post_comment, user). The comment's like_count is kept in sync in
// the same transaction that inserts/deletes here. Mirrors CommentLike.
export interface PostCommentLikeAttributes {
  post_comment_like_id: string;
  post_comment_id: string;
  user_id: string;
  created_at: Date;
}

export type PostCommentLikeCreationAttributes = Optional<
  PostCommentLikeAttributes,
  'post_comment_like_id' | 'created_at'
>;

export interface PostCommentLikeModel
  extends Model<PostCommentLikeAttributes, PostCommentLikeCreationAttributes>,
    PostCommentLikeAttributes {}

const PostCommentLike = sequelize.define<PostCommentLikeModel>(
  'PostCommentLike',
  {
    post_comment_like_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    post_comment_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.PostComment, key: 'post_comment_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.PostCommentLike,
    timestamps: false,
    indexes: [{ unique: true, fields: ['post_comment_id', 'user_id'] }],
  }
);

export default PostCommentLike;
