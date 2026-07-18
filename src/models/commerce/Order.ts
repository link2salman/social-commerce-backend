import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import { ORDER_STATUSES, DEFAULT_CURRENCY, type OrderStatus } from '@constants/enums';

// Totals persisted as integer cents (server-authoritative at checkout time).
export interface OrderAttributes {
  order_id: string;
  user_id: string;
  status: OrderStatus;
  currency: string;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  payment_token: string | null;
  created_at: Date;
}

export type OrderCreationAttributes = Optional<
  OrderAttributes,
  'order_id' | 'status' | 'currency' | 'payment_token' | 'created_at'
>;

export interface OrderModel
  extends Model<OrderAttributes, OrderCreationAttributes>,
    OrderAttributes {}

const Order = sequelize.define<OrderModel>(
  'Order',
  {
    order_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    status: {
      type: DataTypes.ENUM(...ORDER_STATUSES),
      allowNull: false,
      defaultValue: 'confirmed',
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: DEFAULT_CURRENCY,
    },
    subtotal_cents: { type: DataTypes.INTEGER, allowNull: false },
    shipping_cents: { type: DataTypes.INTEGER, allowNull: false },
    tax_cents: { type: DataTypes.INTEGER, allowNull: false },
    total_cents: { type: DataTypes.INTEGER, allowNull: false },
    payment_token: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.Order,
    timestamps: false,
    indexes: [{ fields: ['user_id', 'created_at'] }],
  }
);

export default Order;
