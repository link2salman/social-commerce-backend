import { createHash } from 'crypto';
import { Op, fn, col, literal } from 'sequelize';
import type { Transaction } from 'sequelize';
import type Stripe from 'stripe';
import { sequelize } from '@config/db';
import { NotFoundError, ConflictError } from '@middlewares/error';
import { ERROR_CODES } from '@constants/errorCodes';
import Order, { type OrderModel, type ShippingAddress } from '@models/commerce/Order';
import OrderItem from '@models/commerce/OrderItem';
import Product from '@models/commerce/Product';
import { priceCart, type CartItemInput, type OrderLineData } from '@services/pricingService';
import {
  createPaymentIntent,
  retrievePaymentIntent,
  refundPaymentIntent,
  isPaymentIntentPaid,
} from '@services/paymentService';
import { stripePublishableKey } from '@config/stripe';
import { centsToMajor } from '@utils/money';
import { orderWireStatus, type PaymentStatus } from '@constants/enums';
import {
  serializeOrder,
  serializeOrderDetail,
  type OrderJSON,
  type OrderDetailJSON,
} from '@serializers/orderSerializer';

// ── Checkout integrity helpers ───────────────────────────────────────────────

// Canonical hash of a cart. Lets a double-tap on "Pay" reuse the unpaid order it
// already opened (see createCheckoutIntent) instead of minting a duplicate.
const hashCart = (items: CartItemInput[]): string => {
  const canonical = items
    .map(i => `${i.product_id}:${i.variant_id ?? ''}:${i.quantity}`)
    .sort()
    .join('|');
  return createHash('sha256').update(canonical).digest('hex');
};

// Only an unpaid order opened recently is reusable — never resurrect an
// abandoned cart or a completed purchase.
const REUSE_WINDOW_MS = 60 * 60 * 1000;
const findReusableOrder = (
  userId: string,
  cartHash: string
): Promise<OrderModel | null> =>
  Order.findOne({
    where: {
      user_id: userId,
      cart_hash: cartHash,
      payment_status: 'requires_payment',
      created_at: { [Op.gte]: new Date(Date.now() - REUSE_WINDOW_MS) },
    },
    order: [['created_at', 'DESC']],
  });

// A PaymentIntent is reusable while it still awaits/accepts payment; once it has
// succeeded or been canceled we must open a fresh one.
const REUSABLE_INTENT_STATUSES = new Set<Stripe.PaymentIntent.Status>([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
]);

// Stock is tracked per product; a cart may list one product under several
// variants, so sum quantities per product for the stock guard.
interface StockNeed {
  productId: string;
  title: string;
  quantity: number;
}
const aggregateByProduct = (lines: OrderLineData[]): StockNeed[] => {
  const byProduct = new Map<string, StockNeed>();
  for (const line of lines) {
    const existing = byProduct.get(line.product_id);
    if (existing) existing.quantity += line.quantity;
    else
      byProduct.set(line.product_id, {
        productId: line.product_id,
        title: line.title,
        quantity: line.quantity,
      });
  }
  return [...byProduct.values()];
};

// Atomic, race-safe inventory decrement inside the order transaction. The
// guarded `UPDATE … WHERE stock >= qty` means two checkouts racing for the last
// unit can never both win — one decrements, the other gets 0 rows and 409s.
// (Product is paranoid, so a soft-deleted product also fails the guard.)
const decrementStockOrThrow = async (
  needs: StockNeed[],
  transaction: Transaction
): Promise<void> => {
  for (const need of needs) {
    const [affected] = await Product.update(
      { stock: literal(`stock - ${need.quantity}`) },
      {
        where: { product_id: need.productId, stock: { [Op.gte]: need.quantity } },
        transaction,
      }
    );
    if (affected === 0) {
      throw new ConflictError(`"${need.title}" is out of stock`, ERROR_CODES.OUT_OF_STOCK);
    }
  }
};

// Compensating rollback: if the PaymentIntent call fails AFTER the order was
// committed and stock decremented, remove the order and restore stock so a
// gated/failed checkout leaves no orphan behind and no inventory held.
const releaseOrder = async (
  orderId: string,
  needs: StockNeed[]
): Promise<void> => {
  await sequelize.transaction(async transaction => {
    await OrderItem.destroy({ where: { order_id: orderId }, transaction });
    await Order.destroy({ where: { order_id: orderId }, transaction });
    for (const need of needs) {
      await Product.increment('stock', {
        by: need.quantity,
        where: { product_id: need.productId },
        transaction,
      });
    }
  });
};

// The payment envelope the client needs to drive its PaymentSheet. `provider:
// 'none'` means the order is already settled server-side (a $0 order, or the
// mock backend) and the client skips the sheet — the app never branches on mock
// mode, it just honors what the server returns here.
export interface CheckoutIntentJSON {
  order: OrderJSON;
  provider: 'stripe' | 'none';
  client_secret: string | null;
  publishable_key: string | null;
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

// Persist the order + its lines in a not-yet-paid state, decrementing stock
// atomically in the same transaction. Shared by the $0 and priced paths.
const persistOrder = async (
  userId: string,
  priced: Awaited<ReturnType<typeof priceCart>>,
  cartHash: string,
  stockNeeds: StockNeed[],
  shippingAddress: ShippingAddress | null
): Promise<OrderModel> =>
  sequelize.transaction(async transaction => {
    await decrementStockOrThrow(stockNeeds, transaction);
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
        cart_hash: cartHash,
        shipping_address: shippingAddress,
      },
      { transaction }
    );
    await OrderItem.bulkCreate(
      priced.orderLines.map(line => ({ ...line, order_id: created.order_id })),
      { transaction }
    );
    return created;
  });

// Step 1 of checkout. Price server-side (never trust a client total), enforce
// stock, persist the order atomically, then open a Stripe PaymentIntent for the
// total. Returns the client secret the app confirms against.
export const createCheckoutIntent = async (
  userId: string,
  items: CartItemInput[],
  shippingAddress: ShippingAddress | null = null
): Promise<CheckoutIntentJSON> => {
  const priced = await priceCart(items);
  const lineCount = priced.orderLines.length;
  const stockNeeds = aggregateByProduct(priced.orderLines);
  const cartHash = hashCart(items);

  // Idempotency: a double-tap on "Pay" for the same cart reuses the unpaid order
  // it already opened (and its live PaymentIntent) instead of creating a second
  // order + charge. Only applies to priced orders (a $0 order settles at once).
  if (priced.totalCents > 0) {
    const reusable = await findReusableOrder(userId, cartHash);
    if (reusable?.payment_intent_id) {
      const intent = await retrievePaymentIntent(reusable.payment_intent_id);
      if (REUSABLE_INTENT_STATUSES.has(intent.status) && intent.client_secret) {
        return {
          order: serializeOrder(reusable, lineCount),
          provider: 'stripe',
          client_secret: intent.client_secret,
          publishable_key: stripePublishableKey(),
          amount: centsToMajor(priced.totalCents),
          currency: priced.currency,
        };
      }
    }
  }

  // A $0 order (fully-discounted / free) needs no charge — settle now. This is
  // also the shape the mock backend mirrors so mock-mode checkout keeps working
  // (the client honors provider:'none' and skips the sheet, no mock-mode branch).
  if (priced.totalCents === 0) {
    const order = await persistOrder(userId, priced, cartHash, stockNeeds, shippingAddress);
    await settleOrder(order.order_id, 'succeeded');
    await order.reload();
    return {
      order: serializeOrder(order, lineCount),
      provider: 'none',
      client_secret: null,
      publishable_key: null,
      amount: 0,
      currency: priced.currency,
    };
  }

  const order = await persistOrder(userId, priced, cartHash, stockNeeds, shippingAddress);

  // Open the PaymentIntent. If Stripe is unconfigured (503) or errors, roll the
  // order back and restore stock so a gated/failed checkout leaves no orphan
  // order behind (previously it persisted an unpayable order that still showed
  // in GET /orders). The order_id is the idempotency key, so a retry of the SAME
  // order never double-charges.
  let intent;
  try {
    intent = await createPaymentIntent({
      amountCents: priced.totalCents,
      currency: priced.currency,
      idempotencyKey: order.order_id,
      metadata: { kind: 'order', orderId: order.order_id, userId },
      description: `Order ${order.order_id}`,
    });
  } catch (err) {
    await releaseOrder(order.order_id, stockNeeds);
    throw err;
  }

  await order.update({ payment_intent_id: intent.paymentIntentId });

  return {
    order: serializeOrder(order, lineCount),
    provider: 'stripe',
    client_secret: intent.clientSecret,
    publishable_key: intent.publishableKey,
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

// Refund an order (admin/operator action — see the /admin route). Idempotent: a
// second call on an already-refunded order is a no-op that returns the order,
// so it never asks Stripe to refund a charge twice. Only a settled payment can
// be refunded.
export const refundOrder = async (orderId: string): Promise<OrderJSON> => {
  const order = await Order.findByPk(orderId);
  if (!order) throw new NotFoundError('Order');
  const lineCount = await OrderItem.count({ where: { order_id: orderId } });

  if (order.payment_status === 'refunded') {
    return serializeOrder(order, lineCount); // already refunded — idempotent
  }
  if (order.payment_status !== 'succeeded') {
    throw new ConflictError('Only a paid order can be refunded', ERROR_CODES.ORDER_STATE_INVALID);
  }

  if (order.payment_intent_id) {
    await refundPaymentIntent(order.payment_intent_id);
  }
  await order.update({
    payment_status: 'refunded',
    status: orderWireStatus('refunded'),
    refunded_at: new Date(),
  });
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
