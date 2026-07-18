import type { OrderModel } from '@models/commerce/Order';
import type { OrderItemModel } from '@models/commerce/OrderItem';
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

export interface OrderDetailJSON extends OrderJSON {
  lines: CartLineJSON[];
  subtotal: number;
  shipping: number;
  tax: number;
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
});
