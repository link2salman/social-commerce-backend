import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import { DEFAULT_CURRENCY } from '@constants/enums';

// Price stored as integer minor units (cents); the wire shape is major-unit
// dollars (commerce contract). See utils/money.ts.
export interface ProductAttributes {
  product_id: string;
  seller_id: string;
  title: string;
  description: string;
  price_cents: number;
  currency: string;
  stock: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export type ProductCreationAttributes = Optional<
  ProductAttributes,
  | 'product_id'
  | 'description'
  | 'currency'
  | 'stock'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
>;

export interface ProductModel
  extends Model<ProductAttributes, ProductCreationAttributes>,
    ProductAttributes {}

const Product = sequelize.define<ProductModel>(
  'Product',
  {
    product_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    seller_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Seller, key: 'seller_id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    price_cents: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 0 },
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: DEFAULT_CURRENCY,
    },
    stock: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    deleted_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  },
  {
    tableName: tableNames.Product,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [{ fields: ['seller_id'] }],
  }
);

export default Product;
