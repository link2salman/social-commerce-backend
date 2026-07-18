import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

export interface ProductVariantAttributes {
  variant_id: string;
  product_id: string;
  name: string;
  price_delta_cents: number;
  position: number;
  created_at: Date;
}

export type ProductVariantCreationAttributes = Optional<
  ProductVariantAttributes,
  'variant_id' | 'price_delta_cents' | 'position' | 'created_at'
>;

export interface ProductVariantModel
  extends Model<ProductVariantAttributes, ProductVariantCreationAttributes>,
    ProductVariantAttributes {}

const ProductVariant = sequelize.define<ProductVariantModel>(
  'ProductVariant',
  {
    variant_id: {
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
    name: { type: DataTypes.STRING(120), allowNull: false },
    price_delta_cents: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.ProductVariant,
    timestamps: false,
    indexes: [{ fields: ['product_id'] }],
  }
);

export default ProductVariant;
