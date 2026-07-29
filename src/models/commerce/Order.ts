import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  FULFILLMENT_STATUSES,
  DEFAULT_CURRENCY,
  type OrderStatus,
  type PaymentStatus,
  type FulfillmentStatus,
} from '@constants/enums';

// The shipping address collected at checkout (stored whole as JSONB).
// Stored as JSONB and passed straight through to the wire by orderSerializer,
// so it is snake_case in both — see the note on CallParticipantSnapshot.
export interface ShippingAddress {
  recipient_name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postal_code: string;
  country: string;
}

// Totals persisted as integer cents (server-authoritative at checkout time).
// status = wire fulfillment enum; payment_status = internal Stripe lifecycle
// that drives it. payment_intent_id links to the Stripe PaymentIntent.
export interface OrderAttributes {
  order_id: string;
  user_id: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  currency: string;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  payment_token: string | null;
  payment_intent_id: string | null;
  // SHA-256 of the canonical cart. Lets checkout reuse an unpaid order on a
  // double-tap instead of minting a duplicate. Null on legacy rows.
  cart_hash: string | null;
  // Fulfillment — tracked separately from payment. Address collected at checkout.
  shipping_address: ShippingAddress | null;
  fulfillment_status: FulfillmentStatus;
  tracking_number: string | null;
  carrier: string | null;
  shipped_at: Date | null;
  delivered_at: Date | null;
  refunded_at: Date | null;
  created_at: Date;
}

export type OrderCreationAttributes = Optional<
  OrderAttributes,
  | 'order_id'
  | 'status'
  | 'payment_status'
  | 'currency'
  | 'payment_token'
  | 'payment_intent_id'
  | 'cart_hash'
  | 'shipping_address'
  | 'fulfillment_status'
  | 'tracking_number'
  | 'carrier'
  | 'shipped_at'
  | 'delivered_at'
  | 'refunded_at'
  | 'created_at'
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
      defaultValue: 'processing',
    },
    payment_status: {
      type: DataTypes.ENUM(...PAYMENT_STATUSES),
      allowNull: false,
      defaultValue: 'requires_payment',
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
    payment_intent_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
    },
    cart_hash: { type: DataTypes.STRING(64), allowNull: true },
    shipping_address: { type: DataTypes.JSONB, allowNull: true },
    fulfillment_status: {
      type: DataTypes.ENUM(...FULFILLMENT_STATUSES),
      allowNull: false,
      defaultValue: 'unfulfilled',
    },
    tracking_number: { type: DataTypes.STRING(120), allowNull: true },
    carrier: { type: DataTypes.STRING(80), allowNull: true },
    shipped_at: { type: DataTypes.DATE, allowNull: true },
    delivered_at: { type: DataTypes.DATE, allowNull: true },
    refunded_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.Order,
    timestamps: false,
    indexes: [{ fields: ['user_id', 'created_at'] }],
  }
);

export default Order;
