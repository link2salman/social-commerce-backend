import { z } from 'zod';

// Mirrors the client's CartItemSchema — only references, never prices (pricing
// is server-authoritative).
export const cartItemSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable(),
  // Bounded: an unbounded quantity lets a client inflate an order total to an
  // absurd figure and feeds huge integers into pricing/stock math. 99 is a
  // sane per-line cap (stock is enforced server-side at checkout regardless).
  quantity: z.number().int().positive().max(99),
});

// POST /cart/summary — the cart's item references.
export const cartSummarySchema = z.object({
  items: z.array(cartItemSchema),
});

// The shipping destination collected at checkout. Optional at the schema level
// so digital/free flows and older clients still work; a physical-goods
// deployment should require it (and fulfillment needs it to be present).
export const shippingAddressSchema = z.object({
  recipient_name: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullable().optional().default(null),
  city: z.string().trim().min(1).max(120),
  region: z.string().trim().min(1).max(120),
  postal_code: z.string().trim().min(1).max(20),
  country: z.string().trim().min(2).max(60),
});

// POST /orders/intent — items (+ optional shipping address). The server prices
// them, creates the order in a not-yet-paid state, and returns a Stripe
// PaymentIntent client secret. Payment is proven by confirming the intent
// (POST /orders/:id/confirm) or by the Stripe webhook.
export const checkoutIntentSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  shipping_address: shippingAddressSchema.optional(),
});

// POST /sellers/me/orders/:id/fulfill — a seller marks their order shipped.
export const fulfillOrderSchema = z.object({
  tracking_number: z.string().trim().max(120).optional(),
  carrier: z.string().trim().max(80).optional(),
});

export type ShippingAddressBody = z.infer<typeof shippingAddressSchema>;
export type CartSummaryBody = z.infer<typeof cartSummarySchema>;
export type CheckoutIntentBody = z.infer<typeof checkoutIntentSchema>;
export type FulfillOrderBody = z.infer<typeof fulfillOrderSchema>;
