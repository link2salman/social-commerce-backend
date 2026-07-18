import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// Snapshot fields (title/variant_name/image_url/unit_price_cents) freeze the
// line at purchase time, so a later product edit never rewrites order history.
export interface OrderItemAttributes {
  order_item_id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  title: string;
  variant_name: string | null;
  image_url: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  position: number;
}

export type OrderItemCreationAttributes = Optional<
  OrderItemAttributes,
  'order_item_id' | 'product_id' | 'variant_id' | 'variant_name' | 'position'
>;

export interface OrderItemModel
  extends Model<OrderItemAttributes, OrderItemCreationAttributes>,
    OrderItemAttributes {}

const OrderItem = sequelize.define<OrderItemModel>(
  'OrderItem',
  {
    order_item_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    order_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Order, key: 'order_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: tableNames.Product, key: 'product_id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    variant_id: { type: DataTypes.UUID, allowNull: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    variant_name: { type: DataTypes.STRING(120), allowNull: true },
    image_url: { type: DataTypes.TEXT, allowNull: false },
    unit_price_cents: { type: DataTypes.INTEGER, allowNull: false },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1 },
    },
    line_total_cents: { type: DataTypes.INTEGER, allowNull: false },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    tableName: tableNames.OrderItem,
    timestamps: false,
    indexes: [{ fields: ['order_id'] }],
  }
);

export default OrderItem;
