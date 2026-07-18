import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// Shoppable tag join: a video carries N product pills.
export interface VideoProductAttributes {
  id: string;
  video_id: string;
  product_id: string;
  position: number;
}

export type VideoProductCreationAttributes = Optional<
  VideoProductAttributes,
  'id' | 'position'
>;

export interface VideoProductModel
  extends Model<VideoProductAttributes, VideoProductCreationAttributes>,
    VideoProductAttributes {}

const VideoProduct = sequelize.define<VideoProductModel>(
  'VideoProduct',
  {
    id: {
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
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Product, key: 'product_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    tableName: tableNames.VideoProduct,
    timestamps: false,
    indexes: [{ unique: true, fields: ['video_id', 'product_id'] }],
  }
);

export default VideoProduct;
