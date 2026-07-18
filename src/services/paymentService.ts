import type Stripe from 'stripe';
import {
  getStripe,
  stripeWebhookSecret,
  stripePublishableKey,
} from '@config/stripe';
import { ServiceUnavailableError, BadRequestError } from '@middlewares/error';
import { DEFAULT_CURRENCY } from '@constants/enums';

// Thin wrapper over the Stripe SDK. Everything the rest of the app needs to take
// money goes through here so orders/tickets share one payment implementation and
// one "is it configured?" gate.

const requireStripe = (): Stripe => {
  const stripe = getStripe();
  if (!stripe) {
    throw new ServiceUnavailableError(
      'Payments are not configured. Set STRIPE_SECRET_KEY on the server.'
    );
  }
  return stripe;
};

export interface PaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
}

export interface CreateIntentParams {
  amountCents: number;
  currency?: string;
  /** Stable idempotency key (e.g. the order id) so retries don't double-charge. */
  idempotencyKey: string;
  /** Attached to the PaymentIntent; the webhook reads these to reconcile. */
  metadata: Record<string, string>;
  description?: string;
}

// Stripe rejects amounts below ~$0.50; callers must gate free items before here.
export const createPaymentIntent = async (
  params: CreateIntentParams
): Promise<PaymentIntentResult> => {
  const stripe = requireStripe();
  const currency = (params.currency ?? DEFAULT_CURRENCY).toLowerCase();

  const intent = await stripe.paymentIntents.create(
    {
      amount: params.amountCents,
      currency,
      metadata: params.metadata,
      description: params.description,
      // Let Stripe present every payment method enabled in the dashboard
      // (cards, wallets) — the mobile PaymentSheet renders whatever is returned.
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: `intent_${params.idempotencyKey}` }
  );

  if (!intent.client_secret) {
    throw new BadRequestError('Stripe did not return a client secret.');
  }

  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    publishableKey: stripePublishableKey(),
    amountCents: params.amountCents,
    currency,
  };
};

export const retrievePaymentIntent = async (
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> => {
  const stripe = requireStripe();
  return stripe.paymentIntents.retrieve(paymentIntentId);
};

export const refundPaymentIntent = async (
  paymentIntentId: string
): Promise<Stripe.Refund> => {
  const stripe = requireStripe();
  return stripe.refunds.create({ payment_intent: paymentIntentId });
};

// Verify + parse an inbound webhook. Throws (→ 400) on a bad signature so we
// never act on a forged event. Requires STRIPE_WEBHOOK_SECRET.
export const constructWebhookEvent = (
  rawBody: Buffer,
  signature: string | undefined
): Stripe.Event => {
  const stripe = requireStripe();
  const secret = stripeWebhookSecret();
  if (!secret) {
    throw new ServiceUnavailableError(
      'Webhook secret not configured. Set STRIPE_WEBHOOK_SECRET.'
    );
  }
  if (!signature) throw new BadRequestError('Missing Stripe-Signature header.');
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new BadRequestError('Invalid Stripe webhook signature.');
  }
};

/** True once a PaymentIntent has actually captured funds. */
export const isPaymentIntentPaid = (intent: Stripe.PaymentIntent): boolean =>
  intent.status === 'succeeded';
