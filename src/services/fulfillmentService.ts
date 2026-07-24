import { Op } from 'sequelize';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '@middlewares/error';
import Order, { type OrderModel } from '@models/commerce/Order';
import OrderItem, { type OrderItemModel } from '@models/commerce/OrderItem';
import Product from '@models/commerce/Product';
import Seller, { type SellerModel } from '@models/commerce/Seller';
import User from '@models/user/User';
import {
  serializeSellerOrder,
  type SellerOrderJSON,
  type SellerOrderBuyer,
} from '@serializers/orderSerializer';
import type { FulfillOrderBody } from '@validators/cartValidators';

// ─────────────────────────────────────────────────────────────────────────────
// Seller-facing fulfillment. A seller sees the PAID orders that contain their
// products, and drives each through unfulfilled → shipped → delivered. Ownership
// = "the seller has at least one product in the order". Fulfillment lives at the
// order level (a v1 simplification); per-seller split shipments for a
// multi-seller order are a future refinement — see DEFERRED-DECISIONS.md §3.
// ─────────────────────────────────────────────────────────────────────────────

// Payment states a seller is allowed to see / act on (an unpaid pending order
// isn't the seller's concern yet).
const VISIBLE_PAYMENT = ['succeeded', 'refunded'] as const;

const sellerProductIds = async (sellerId: string): Promise<string[]> => {
  // paranoid:false — a soft-deleted product still has orders that need shipping.
  const products = await Product.findAll({
    where: { seller_id: sellerId },
    attributes: ['product_id'],
    paranoid: false,
  });
  return products.map(p => p.product_id);
};

const buyerOf = async (userId: string): Promise<SellerOrderBuyer> => {
  const user = await User.findByPk(userId, {
    attributes: ['user_id', 'username', 'display_name', 'avatar_url'],
  });
  return {
    id: userId,
    username: user?.username ?? 'unknown',
    displayName: user?.display_name ?? 'unknown',
    avatarUrl: user?.avatar_url ?? null,
  };
};

// Build the seller's view of one order — only THIS seller's line items.
const buildSellerOrder = async (
  order: OrderModel,
  productIds: string[]
): Promise<SellerOrderJSON> => {
  const items = productIds.length
    ? await OrderItem.findAll({
        where: { order_id: order.order_id, product_id: { [Op.in]: productIds } },
      })
    : [];
  return serializeSellerOrder(order, await buyerOf(order.user_id), items);
};

// Load the caller's seller profile and assert they have a product in the order.
const requireSellerWithOrder = async (
  userId: string,
  orderId: string
): Promise<{ seller: SellerModel; productIds: string[] }> => {
  const seller = await Seller.findOne({ where: { user_id: userId } });
  if (!seller) throw new ForbiddenError('You are not a seller');
  const productIds = await sellerProductIds(seller.seller_id);
  const count = productIds.length
    ? await OrderItem.count({
        where: { order_id: orderId, product_id: { [Op.in]: productIds } },
      })
    : 0;
  if (count === 0) {
    throw new ForbiddenError('This order contains none of your products');
  }
  return { seller, productIds };
};

export const listSellerOrders = async (
  userId: string
): Promise<{ items: SellerOrderJSON[] }> => {
  const seller = await Seller.findOne({ where: { user_id: userId } });
  if (!seller) return { items: [] };
  const productIds = await sellerProductIds(seller.seller_id);
  if (!productIds.length) return { items: [] };

  const myItems = await OrderItem.findAll({
    where: { product_id: { [Op.in]: productIds } },
  });
  if (!myItems.length) return { items: [] };

  const orderIds = [...new Set(myItems.map(i => i.order_id))];
  const orders = await Order.findAll({
    where: {
      order_id: { [Op.in]: orderIds },
      payment_status: { [Op.in]: [...VISIBLE_PAYMENT] },
    },
    order: [['created_at', 'DESC']],
  });
  if (!orders.length) return { items: [] };

  // Group the seller's items by order (only orders that survived the paid filter).
  const orderIdSet = new Set(orders.map(o => o.order_id));
  const itemsByOrder = new Map<string, OrderItemModel[]>();
  for (const item of myItems) {
    if (!orderIdSet.has(item.order_id)) continue;
    const arr = itemsByOrder.get(item.order_id) ?? [];
    arr.push(item);
    itemsByOrder.set(item.order_id, arr);
  }

  const buyerIds = [...new Set(orders.map(o => o.user_id))];
  const buyers = await User.findAll({
    where: { user_id: { [Op.in]: buyerIds } },
    attributes: ['user_id', 'username', 'display_name', 'avatar_url'],
  });
  const buyerById = new Map(
    buyers.map(u => [
      u.user_id,
      {
        id: u.user_id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: u.avatar_url,
      } satisfies SellerOrderBuyer,
    ])
  );

  const items = orders.map(o =>
    serializeSellerOrder(
      o,
      buyerById.get(o.user_id) ?? {
        id: o.user_id,
        username: 'unknown',
        displayName: 'unknown',
        avatarUrl: null,
      },
      itemsByOrder.get(o.order_id) ?? []
    )
  );
  return { items };
};

// unfulfilled|shipped → shipped (idempotent-ish: re-shipping updates tracking;
// shipped_at is set once). Only a PAID order can ship.
export const fulfillOrder = async (
  userId: string,
  orderId: string,
  input: FulfillOrderBody
): Promise<SellerOrderJSON> => {
  const { productIds } = await requireSellerWithOrder(userId, orderId);
  const order = await Order.findByPk(orderId);
  if (!order) throw new NotFoundError('Order');
  if (order.payment_status !== 'succeeded') {
    throw new ConflictError('Only a paid order can be fulfilled');
  }
  if (order.fulfillment_status === 'delivered') {
    throw new ConflictError('This order is already delivered');
  }

  await order.update({
    fulfillment_status: 'shipped',
    tracking_number: input.trackingNumber ?? order.tracking_number,
    carrier: input.carrier ?? order.carrier,
    shipped_at: order.shipped_at ?? new Date(),
  });
  return buildSellerOrder(order, productIds);
};

// shipped → delivered.
export const markOrderDelivered = async (
  userId: string,
  orderId: string
): Promise<SellerOrderJSON> => {
  const { productIds } = await requireSellerWithOrder(userId, orderId);
  const order = await Order.findByPk(orderId);
  if (!order) throw new NotFoundError('Order');
  if (order.fulfillment_status !== 'shipped') {
    throw new ConflictError('Only a shipped order can be marked delivered');
  }
  await order.update({ fulfillment_status: 'delivered', delivered_at: new Date() });
  return buildSellerOrder(order, productIds);
};
