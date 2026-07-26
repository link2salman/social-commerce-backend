import type { OrderModel, ShippingAddress } from '@models/commerce/Order';
import type { OrderItemModel } from '@models/commerce/OrderItem';
import type { FulfillmentStatus, PaymentStatus } from '@constants/enums';
import { centsToMajor } from '@utils/money';

// The client's order.schema.ts shapes, snake_case on the wire. Money is
// MAJOR-unit dollars here (commerce contract); it is stored as integer cents and
// converted only at this boundary. `ShippingAddress` is passed straight through
// from the JSONB column, which stores the same snake_case shape.
export interface CartLineJSON {
  product_id: string;
  variant_id: string | null;
  title: string;
  variant_name: string | null;
  image_url: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface CartSummaryJSON {
  lines: CartLineJSON[];
  currency: string;
  item_count: number;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
}

export interface OrderJSON {
  id: string;
  status: 'confirmed' | 'processing' | 'failed';
  currency: string;
  total: number;
  line_count: number;
  created_at: string;
}

export interface FulfillmentJSON {
  status: FulfillmentStatus;
  tracking_number: string | null;
  carrier: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
}

const toFulfillment = (o: OrderModel): FulfillmentJSON => ({
  status: o.fulfillment_status,
  tracking_number: o.tracking_number,
  carrier: o.carrier,
  shipped_at: o.shipped_at ? o.shipped_at.toISOString() : null,
  delivered_at: o.delivered_at ? o.delivered_at.toISOString() : null,
});

export interface OrderDetailJSON extends OrderJSON {
  lines: CartLineJSON[];
  subtotal: number;
  shipping: number;
  tax: number;
  shipping_address: ShippingAddress | null;
  fulfillment: FulfillmentJSON;
}

// A seller's view of an order that contains their product(s): the buyer, only
// THIS seller's line items, and the order-level fulfillment + address so they
// can ship it.
export interface SellerOrderBuyer {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface SellerOrderJSON {
  id: string;
  buyer: SellerOrderBuyer;
  items: CartLineJSON[];
  item_count: number;
  seller_total: number;
  payment_status: PaymentStatus;
  fulfillment: FulfillmentJSON;
  shipping_address: ShippingAddress | null;
  created_at: string;
}

export const orderLineFromItem = (item: OrderItemModel): CartLineJSON => ({
  product_id: item.product_id ?? '',
  variant_id: item.variant_id,
  title: item.title,
  variant_name: item.variant_name,
  image_url: item.image_url,
  unit_price: centsToMajor(item.unit_price_cents),
  quantity: item.quantity,
  line_total: centsToMajor(item.line_total_cents),
});

export const serializeOrder = (
  order: OrderModel,
  lineCount: number
): OrderJSON => ({
  id: order.order_id,
  status: order.status,
  currency: order.currency,
  total: centsToMajor(order.total_cents),
  line_count: lineCount,
  created_at: order.created_at.toISOString(),
});

export const serializeOrderDetail = (
  order: OrderModel,
  items: OrderItemModel[]
): OrderDetailJSON => ({
  ...serializeOrder(order, items.length),
  lines: [...items]
    .sort((a, z) => a.position - z.position)
    .map(orderLineFromItem),
  subtotal: centsToMajor(order.subtotal_cents),
  shipping: centsToMajor(order.shipping_cents),
  tax: centsToMajor(order.tax_cents),
  shipping_address: order.shipping_address,
  fulfillment: toFulfillment(order),
});

export const serializeSellerOrder = (
  order: OrderModel,
  buyer: SellerOrderBuyer,
  sellerItems: OrderItemModel[]
): SellerOrderJSON => {
  const lines = [...sellerItems]
    .sort((a, z) => a.position - z.position)
    .map(orderLineFromItem);
  return {
    id: order.order_id,
    buyer,
    items: lines,
    item_count: lines.reduce((sum, l) => sum + l.quantity, 0),
    seller_total: centsToMajor(
      sellerItems.reduce((sum, i) => sum + i.line_total_cents, 0)
    ),
    payment_status: order.payment_status,
    fulfillment: toFulfillment(order),
    shipping_address: order.shipping_address,
    created_at: order.created_at.toISOString(),
  };
};
