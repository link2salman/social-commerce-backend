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

// POST /orders — items + a payment token (mock string today; a confirmed Stripe
// PaymentIntent id later).
export const checkoutSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  paymentToken: z.string().min(1),
});

export type CartSummaryBody = z.infer<typeof cartSummarySchema>;
export type CheckoutBody = z.infer<typeof checkoutSchema>;
