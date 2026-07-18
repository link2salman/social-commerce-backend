import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// A comment or a reply — one shape, distinguished by parent_id. Threads are one
// level deep (a reply's parent is always a top-level comment; enforced in the
// service). like_count is denormalized; replyCount is derived on read.
export interface CommentAttributes {
  comment_id: string;
  video_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  like_count: number;
  created_at: Date;
}

export type CommentCreationAttributes = Optional<
  CommentAttributes,
  'comment_id' | 'parent_id' | 'like_count' | 'created_at'
>;

export interface CommentModel
  extends Model<CommentAttributes, CommentCreationAttributes>,
    CommentAttributes {}

const Comment = sequelize.define<CommentModel>(
  'Comment',
  {
    comment_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    video_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Video, key: 'video_id' },
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
      references: { model: tableNames.Comment, key: 'comment_id' },
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
    tableName: tableNames.Comment,
    timestamps: false,
    indexes: [
      { fields: ['video_id', 'parent_id', 'created_at'] },
      { fields: ['parent_id'] },
    ],
  }
);

export default Comment;
