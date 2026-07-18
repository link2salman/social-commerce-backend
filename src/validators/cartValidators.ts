import { z } from 'zod';

// Mirrors the client's CartItemSchema — only references, never prices (pricing
// is server-authoritative).
export const cartItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  quantity: z.number().int().positive(),
});

// POST /cart/summary — the cart's item references.
export const cartSummarySchema = z.object({
  items: z.array(cartItemSchema),
});

// POST /orders/intent — items only. The server prices them, creates the order in
// a not-yet-paid state, and returns a Stripe PaymentIntent client secret. There
// is no client-supplied payment token anymore; payment is proven by confirming
// the intent (POST /orders/:id/confirm) or by the Stripe webhook.
export const checkoutIntentSchema = z.object({
  items: z.array(cartItemSchema).min(1),
});

export type CartSummaryBody = z.infer<typeof cartSummarySchema>;
export type CheckoutIntentBody = z.infer<typeof checkoutIntentSchema>;
