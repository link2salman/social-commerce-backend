import { Op, fn, col } from 'sequelize';
import type { Transaction } from 'sequelize';
import { sequelize } from '@config/db';
import { NotFoundError } from '@middlewares/error';
import Order from '@models/commerce/Order';
import OrderItem from '@models/commerce/OrderItem';
import { priceCart, type CartItemInput } from '@services/pricingService';
import {
  createPaymentIntent,
  retrievePaymentIntent,
  refundPaymentIntent,
  isPaymentIntentPaid,
} from '@services/paymentService';
import { centsToMajor } from '@utils/money';
import { orderWireStatus, type PaymentStatus } from '@constants/enums';
import {
  serializeOrder,
  serializeOrderDetail,
  type OrderJSON,
  type OrderDetailJSON,
} from '@serializers/orderSerializer';

// The payment envelope the client needs to drive its PaymentSheet. `provider:
// 'none'` means the order is already settled server-side (a $0 order, or the
// mock backend) and the client skips the sheet — the app never branches on mock
// mode, it just honors what the server returns here.
export interface CheckoutIntentJSON {
  order: OrderJSON;
  provider: 'stripe' | 'none';
  clientSecret: string | null;
  publishableKey: string | null;
  amount: number;
  currency: string;
}

const settleOrder = async (
  orderId: string,
  paymentStatus: PaymentStatus,
  transaction?: Transaction
): Promise<void> => {
  await Order.update(
    { payment_status: paymentStatus, status: orderWireStatus(paymentStatus) },
    { where: { order_id: orderId }, transaction }
  );
};

// Step 1 of checkout. Price server-side (never trust a client total), persist the
// order + its lines atomically in a not-yet-paid state, then open a Stripe
// PaymentIntent for the total. Returns the client secret the app confirms against.
export const createCheckoutIntent = async (
  userId: string,
  items: CartItemInput[]
): Promise<CheckoutIntentJSON> => {
  const priced = await priceCart(items);

  const order = await sequelize.transaction(async transaction => {
    const created = await Order.create(
      {
        user_id: userId,
        status: 'processing',
        payment_status: 'requires_payment',
        currency: priced.currency,
        subtotal_cents: priced.subtotalCents,
        shipping_cents: priced.shippingCents,
        tax_cents: priced.taxCents,
        total_cents: priced.totalCents,
      },
      { transaction }
    );
    await OrderItem.bulkCreate(
      priced.orderLines.map(line => ({ ...line, order_id: created.order_id })),
      { transaction }
    );
    return created;
  });

  const lineCount = priced.orderLines.length;

  // A $0 order (fully-discounted / free) needs no charge — settle now. This is
  // also the shape the mock backend mirrors so mock-mode checkout keeps working
  // (the client honors provider:'none' and skips the sheet, no mock-mode branch).
  if (priced.totalCents === 0) {
    await settleOrder(order.order_id, 'succeeded');
    await order.reload();
    return {
      order: serializeOrder(order, lineCount),
      provider: 'none',
      clientSecret: null,
      publishableKey: null,
      amount: 0,
      currency: priced.currency,
    };
  }

  // A priced order with no Stripe configured throws a clear 503 here (requireStripe).
  const intent = await createPaymentIntent({
    amountCents: priced.totalCents,
    currency: priced.currency,
    idempotencyKey: order.order_id,
    metadata: { kind: 'order', orderId: order.order_id, userId },
    description: `Order ${order.order_id}`,
  });

  await order.update({ payment_intent_id: intent.paymentIntentId });

  return {
    order: serializeOrder(order, lineCount),
    provider: 'stripe',
    clientSecret: intent.clientSecret,
    publishableKey: intent.publishableKey,
    amount: centsToMajor(priced.totalCents),
    currency: priced.currency,
  };
};

// Step 2 of checkout. Called after the PaymentSheet reports success; we confirm
// against Stripe directly (source of truth) so the flow completes even before the
// async webhook lands — important in dev where webhooks may not reach localhost.
export const confirmOrder = async (
  userId: string,
  orderId: string
): Promise<OrderJSON> => {
  const order = await Order.findOne({
    where: { order_id: orderId, user_id: userId },
  });
  if (!order) throw new NotFoundError('Order');

  const lineCount = await OrderItem.count({ where: { order_id: orderId } });

  if (order.payment_status === 'succeeded' || !order.payment_intent_id) {
    return serializeOrder(order, lineCount);
  }

  const intent = await retrievePaymentIntent(order.payment_intent_id);
  const next: PaymentStatus = isPaymentIntentPaid(intent)
    ? 'succeeded'
    : intent.status === 'canceled'
      ? 'failed'
      : 'processing';

  if (next !== order.payment_status) {
    await settleOrder(orderId, next);
    await order.reload();
  }
  return serializeOrder(order, lineCount);
};

// Webhook-driven reconciliation (authoritative in production). Idempotent: a
// replayed event that finds the order already in its target state is a no-op.
export const applyOrderPaymentResult = async (
  paymentIntentId: string,
  paid: boolean
): Promise<void> => {
  const order = await Order.findOne({
    where: { payment_intent_id: paymentIntentId },
  });
  if (!order) return;
  const next: PaymentStatus = paid ? 'succeeded' : 'failed';
  if (order.payment_status === next) return;
  await settleOrder(order.order_id, next);
};

export const refundOrder = async (orderId: string): Promise<OrderJSON> => {
  const order = await Order.findByPk(orderId);
  if (!order) throw new NotFoundError('Order');
  if (order.payment_intent_id) {
    await refundPaymentIntent(order.payment_intent_id);
  }
  await order.update({
    payment_status: 'refunded',
    status: orderWireStatus('refunded'),
    refunded_at: new Date(),
  });
  const lineCount = await OrderItem.count({ where: { order_id: orderId } });
  return serializeOrder(order, lineCount);
};

export const listOrders = async (
  userId: string
): Promise<{ items: OrderJSON[] }> => {
  const orders = await Order.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
  });
  if (orders.length === 0) return { items: [] };

  const counts = (await OrderItem.findAll({
    where: { order_id: { [Op.in]: orders.map(o => o.order_id) } },
    attributes: ['order_id', [fn('COUNT', col('order_item_id')), 'count']],
    group: ['order_id'],
    raw: true,
  })) as unknown as Array<{ order_id: string; count: string }>;
  const countByOrder = new Map(counts.map(c => [c.order_id, Number(c.count)]));

  return {
    items: orders.map(o =>
      serializeOrder(o, countByOrder.get(o.order_id) ?? 0)
    ),
  };
};

export const getOrderDetail = async (
  userId: string,
  orderId: string
): Promise<OrderDetailJSON> => {
  const order = await Order.findOne({
    where: { order_id: orderId, user_id: userId },
  });
  if (!order) throw new NotFoundError('Order');
  const items = await OrderItem.findAll({ where: { order_id: orderId } });
  return serializeOrderDetail(order, items);
};
