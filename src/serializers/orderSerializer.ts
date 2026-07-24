import type { OrderModel, ShippingAddress } from '@models/commerce/Order';
import type { OrderItemModel } from '@models/commerce/OrderItem';
import type { FulfillmentStatus, PaymentStatus } from '@constants/enums';
import { centsToMajor } from '@utils/money';

// The client's order.schema.ts shapes. Money is MAJOR-unit dollars on the wire.
export interface CartLineJSON {
  productId: string;
  variantId: string | null;
  title: string;
  variantName: string | null;
  imageUrl: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface CartSummaryJSON {
  lines: CartLineJSON[];
  currency: string;
  itemCount: number;
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
  lineCount: number;
  createdAt: string;
}

export interface FulfillmentJSON {
  status: FulfillmentStatus;
  trackingNumber: string | null;
  carrier: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

const toFulfillment = (o: OrderModel): FulfillmentJSON => ({
  status: o.fulfillment_status,
  trackingNumber: o.tracking_number,
  carrier: o.carrier,
  shippedAt: o.shipped_at ? o.shipped_at.toISOString() : null,
  deliveredAt: o.delivered_at ? o.delivered_at.toISOString() : null,
});

export interface OrderDetailJSON extends OrderJSON {
  lines: CartLineJSON[];
  subtotal: number;
  shipping: number;
  tax: number;
  shippingAddress: ShippingAddress | null;
  fulfillment: FulfillmentJSON;
}

// A seller's view of an order that contains their product(s): the buyer, only
// THIS seller's line items, and the order-level fulfillment + address so they
// can ship it.
export interface SellerOrderBuyer {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface SellerOrderJSON {
  id: string;
  buyer: SellerOrderBuyer;
  items: CartLineJSON[];
  itemCount: number;
  sellerTotal: number;
  paymentStatus: PaymentStatus;
  fulfillment: FulfillmentJSON;
  shippingAddress: ShippingAddress | null;
  createdAt: string;
}

export const orderLineFromItem = (item: OrderItemModel): CartLineJSON => ({
  productId: item.product_id ?? '',
  variantId: item.variant_id,
  title: item.title,
  variantName: item.variant_name,
  imageUrl: item.image_url,
  unitPrice: centsToMajor(item.unit_price_cents),
  quantity: item.quantity,
  lineTotal: centsToMajor(item.line_total_cents),
});

export const serializeOrder = (
  order: OrderModel,
  lineCount: number
): OrderJSON => ({
  id: order.order_id,
  status: order.status,
  currency: order.currency,
  total: centsToMajor(order.total_cents),
  lineCount,
  createdAt: order.created_at.toISOString(),
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
  shippingAddress: order.shipping_address,
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
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    sellerTotal: centsToMajor(
      sellerItems.reduce((sum, i) => sum + i.line_total_cents, 0)
    ),
    paymentStatus: order.payment_status,
    fulfillment: toFulfillment(order),
    shippingAddress: order.shipping_address,
    createdAt: order.created_at.toISOString(),
  };
};
