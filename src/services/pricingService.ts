import { NotFoundError } from '@middlewares/error';
import { centsToMajor } from '@utils/money';
import { numberEnv } from '@utils/env';
import { DEFAULT_CURRENCY } from '@constants/enums';
import { loadProductBundles } from '@services/productService';
import type { CartSummaryJSON, CartLineJSON } from '@serializers/orderSerializer';

// Server-authoritative pricing, computed entirely in INTEGER CENTS so the
// persisted totals are exact — subtotal + shipping + tax always equals total at
// the cent level, with no float round-trip. The dollar wire shape is projected
// at the boundary via centsToMajor. Rates are configurable but default to the
// values the app's mock (mockCartSummary) uses byte-for-byte: flat $6.99
// shipping over any non-empty cart, 8% tax.
const FLAT_SHIPPING_CENTS = numberEnv('SHIPPING_FLAT_CENTS', 699);
const TAX_RATE = numberEnv('TAX_RATE', 0.08);

export interface CartItemInput {
  productId: string;
  variantId: string | null;
  quantity: number;
}

// Fields needed to persist an order line (cents + snapshot).
export interface OrderLineData {
  product_id: string;
  variant_id: string | null;
  title: string;
  variant_name: string | null;
  image_url: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  position: number;
}

export interface PricedCart {
  summary: CartSummaryJSON;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  orderLines: OrderLineData[];
}

export const priceCart = async (items: CartItemInput[]): Promise<PricedCart> => {
  const bundles = await loadProductBundles(items.map(i => i.productId));

  const lines: CartLineJSON[] = [];
  const orderLines: OrderLineData[] = [];
  let currency = DEFAULT_CURRENCY;

  items.forEach((item, index) => {
    const bundle = bundles.get(item.productId);
    if (!bundle) throw new NotFoundError('Product');
    const { product } = bundle;
    const variant = item.variantId
      ? bundle.variants.find(v => v.variant_id === item.variantId) ?? null
      : null;

    const unitPriceCents =
      product.price_cents + (variant ? variant.price_delta_cents : 0);
    const lineTotalCents = unitPriceCents * item.quantity;
    const imageUrl =
      [...bundle.images].sort((a, z) => a.position - z.position)[0]?.url ??
      product.title;
    currency = product.currency;

    lines.push({
      productId: product.product_id,
      variantId: variant?.variant_id ?? null,
      title: product.title,
      variantName: variant?.name ?? null,
      imageUrl,
      unitPrice: centsToMajor(unitPriceCents),
      quantity: item.quantity,
      lineTotal: centsToMajor(lineTotalCents),
    });
    orderLines.push({
      product_id: product.product_id,
      variant_id: variant?.variant_id ?? null,
      title: product.title,
      variant_name: variant?.name ?? null,
      image_url: imageUrl,
      unit_price_cents: unitPriceCents,
      quantity: item.quantity,
      line_total_cents: lineTotalCents,
      position: index,
    });
  });

  const subtotalCents = orderLines.reduce((sum, l) => sum + l.line_total_cents, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const shippingCents = subtotalCents > 0 ? FLAT_SHIPPING_CENTS : 0;
  const taxCents = Math.round(subtotalCents * TAX_RATE);
  const totalCents = subtotalCents + shippingCents + taxCents;

  return {
    summary: {
      lines,
      currency,
      itemCount,
      subtotal: centsToMajor(subtotalCents),
      shipping: centsToMajor(shippingCents),
      tax: centsToMajor(taxCents),
      total: centsToMajor(totalCents),
    },
    currency,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents,
    orderLines,
  };
};
