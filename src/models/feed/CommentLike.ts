import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// One row per (comment, user). The comment's like_count is kept in sync in the
// same transaction that inserts/deletes here.
export interface CommentLikeAttributes {
  like_id: string;
  comment_id: string;
  user_id: string;
  created_at: Date;
}

export type CommentLikeCreationAttributes = Optional<
  CommentLikeAttributes,
  'like_id' | 'created_at'
>;

export interface CommentLikeModel
  extends Model<CommentLikeAttributes, CommentLikeCreationAttributes>,
    CommentLikeAttributes {}

const CommentLike = sequelize.define<CommentLikeModel>(
  'CommentLike',
  {
    like_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    comment_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Comment, key: 'comment_id' },
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
    tableName: tableNames.CommentLike,
    timestamps: false,
    indexes: [{ unique: true, fields: ['comment_id', 'user_id'] }],
  }
);

export default CommentLike;
