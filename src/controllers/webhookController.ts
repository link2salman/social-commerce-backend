import type { Request, Response } from 'express';
import type Stripe from 'stripe';
import { asyncHandler } from '@utils/asyncHandler';
import { constructWebhookEvent } from '@services/paymentService';
import { applyOrderPaymentResult } from '@services/orderService';
import { applyTicketPaymentResult } from '@services/eventService';
import logger from '@utils/logger';

// POST /v1/webhooks/stripe — Stripe's async source of truth for payment outcomes.
// Mounted with a RAW body parser (see app.ts) BEFORE express.json(), because
// signature verification hashes the exact bytes Stripe sent. Always 200s on a
// verified event (even an unhandled type) so Stripe stops retrying; a bad
// signature throws → 400.
//
// Reconciliation is idempotent: PaymentSheet's own confirm call (POST
// /orders/:id/confirm) and this webhook can both land; whichever is first wins
// and the second is a no-op.
const dispatch = async (intent: Stripe.PaymentIntent): Promise<void> => {
  const paid = intent.status === 'succeeded';
  const kind = intent.metadata?.kind;

  switch (kind) {
    case 'order':
      await applyOrderPaymentResult(intent.id, paid);
      break;
    case 'event_ticket':
      await applyTicketPaymentResult(intent.id, paid);
      break;
    default:
      logger.warn({ kind, intentId: intent.id }, 'Unhandled payment kind');
  }
};

export const stripeWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    // app.ts mounts express.raw() for this path → req.body is a Buffer.
    const event = constructWebhookEvent(
      req.body as Buffer,
      req.headers['stripe-signature'] as string | undefined
    );

    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        await dispatch(event.data.object as Stripe.PaymentIntent);
        break;
      default:
        logger.debug({ type: event.type }, 'Ignored Stripe event');
    }

    // Stripe's contract, not ours: it only needs a 2xx to stop redelivering,
    // and `{ received: true }` is the conventional ack. Deliberately outside the
    // { success, message, data } envelope — no app client reads this route.
    res.json({ received: true });
  }
);
