import { Op, fn, col } from 'sequelize';
import { sequelize } from '@config/db';
import { NotFoundError } from '@middlewares/error';
import Order from '@models/commerce/Order';
import OrderItem from '@models/commerce/OrderItem';
import { priceCart, type CartItemInput } from '@services/pricingService';
import {
  serializeOrder,
  serializeOrderDetail,
  type OrderJSON,
  type OrderDetailJSON,
} from '@serializers/orderSerializer';

// Checkout. Pricing is recomputed server-side (never trust a client total); the
// order + its lines are written atomically. paymentToken is accepted as-is
// (mock) — a real Stripe PaymentIntent confirmation slots in here later.
export const createOrder = async (
  userId: string,
  items: CartItemInput[],
  paymentToken: string
): Promise<OrderJSON> => {
  const priced = await priceCart(items);

  const order = await sequelize.transaction(async transaction => {
    const created = await Order.create(
      {
        user_id: userId,
        status: 'confirmed',
        currency: priced.currency,
        subtotal_cents: priced.subtotalCents,
        shipping_cents: priced.shippingCents,
        tax_cents: priced.taxCents,
        total_cents: priced.totalCents,
        payment_token: paymentToken,
      },
      { transaction }
    );
    await OrderItem.bulkCreate(
      priced.orderLines.map(line => ({ ...line, order_id: created.order_id })),
      { transaction }
    );
    return created;
  });

  return serializeOrder(order, priced.orderLines.length);
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
