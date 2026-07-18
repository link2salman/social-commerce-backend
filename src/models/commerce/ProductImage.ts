import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

export interface ProductImageAttributes {
  image_id: string;
  product_id: string;
  url: string;
  position: number;
}

export type ProductImageCreationAttributes = Optional<
  ProductImageAttributes,
  'image_id' | 'position'
>;

export interface ProductImageModel
  extends Model<ProductImageAttributes, ProductImageCreationAttributes>,
    ProductImageAttributes {}

const ProductImage = sequelize.define<ProductImageModel>(
  'ProductImage',
  {
    image_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Product, key: 'product_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    url: { type: DataTypes.TEXT, allowNull: false },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    tableName: tableNames.ProductImage,
    timestamps: false,
    indexes: [{ fields: ['product_id'] }],
  }
);

export default ProductImage;
