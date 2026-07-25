import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// An image attached to a post — the media already lives in storage (the client
// uploaded it via the signed-URL upload route), so this is just the URL plus its
// position in the carousel. Ordered by `position`; a post may have 0..n.
export interface PostImageAttributes {
  post_image_id: string;
  post_id: string;
  url: string;
  position: number;
  created_at: Date;
}

export type PostImageCreationAttributes = Optional<
  PostImageAttributes,
  'post_image_id' | 'created_at'
>;

export interface PostImageModel
  extends Model<PostImageAttributes, PostImageCreationAttributes>,
    PostImageAttributes {}

const PostImage = sequelize.define<PostImageModel>(
  'PostImage',
  {
    post_image_id: {
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
    url: { type: DataTypes.TEXT, allowNull: false },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.PostImage,
    timestamps: false,
    indexes: [{ fields: ['post_id', 'position'] }],
  }
);

export default PostImage;
