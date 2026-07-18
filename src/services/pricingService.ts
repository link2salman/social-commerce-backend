import { NotFoundError } from '@middlewares/error';
import { centsToMajor, majorToCents, round2 } from '@utils/money';
import { DEFAULT_CURRENCY } from '@constants/enums';
import { loadProductBundles } from '@services/productService';
import type { CartSummaryJSON, CartLineJSON } from '@serializers/orderSerializer';

// Server-authoritative pricing, byte-for-byte with the app's mock
// (mockCartSummary): flat shipping over any non-empty cart, 8% tax, 2-dp
// rounding at each step so the wire output is identical.
const FLAT_SHIPPING = 6.99;
const TAX_RATE = 0.08;

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

    const priceDollars = centsToMajor(product.price_cents);
    const deltaDollars = variant ? centsToMajor(variant.price_delta_cents) : 0;
    const unitPrice = round2(priceDollars + deltaDollars);
    const lineTotal = round2(unitPrice * item.quantity);
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
      unitPrice,
      quantity: item.quantity,
      lineTotal,
    });
    orderLines.push({
      product_id: product.product_id,
      variant_id: variant?.variant_id ?? null,
      title: product.title,
      variant_name: variant?.name ?? null,
      image_url: imageUrl,
      unit_price_cents: majorToCents(unitPrice),
      quantity: item.quantity,
      line_total_cents: majorToCents(lineTotal),
      position: index,
    });
  });

  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const shipping = subtotal > 0 ? FLAT_SHIPPING : 0;
  const tax = round2(subtotal * TAX_RATE);
  const total = round2(subtotal + shipping + tax);

  return {
    summary: { lines, currency, itemCount, subtotal, shipping, tax, total },
    currency,
    subtotalCents: majorToCents(subtotal),
    shippingCents: majorToCents(shipping),
    taxCents: majorToCents(tax),
    totalCents: majorToCents(total),
    orderLines,
  };
};
