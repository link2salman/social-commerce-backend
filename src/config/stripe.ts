import Stripe from 'stripe';
import { optionalEnv } from '@utils/env';
import logger from '@utils/logger';

// Stripe is OPTIONAL at boot: the server starts without keys so local dev and CI
// run, but any payment path returns 503 (ServiceUnavailableError) until
// STRIPE_SECRET_KEY is set. This is the "wired but disabled until you drop in the
// env value" contract the whole integration layer follows.
//
// Physical goods + in-person tickets are sold here, so Stripe (not IAP/Play
// Billing) is the correct and store-compliant processor — see ARCHITECTURE.md.

let client: Stripe | null = null;
let initialized = false;

export const getStripe = (): Stripe | null => {
  if (initialized) return client;
  initialized = true;

  const key = optionalEnv('STRIPE_SECRET_KEY');
  if (!key) {
    logger.warn('STRIPE_SECRET_KEY not set — payment endpoints will return 503.');
    return null;
  }
  // apiVersion is intentionally omitted → the SDK uses the account's pinned
  // default, which is what the Stripe dashboard/webhooks agree on.
  client = new Stripe(key, { typescript: true });
  logger.info('Stripe payment provider initialized.');
  return client;
};

export const isStripeConfigured = (): boolean => getStripe() !== null;

/** The publishable key the mobile client needs to init its PaymentSheet. */
export const stripePublishableKey = (): string =>
  optionalEnv('STRIPE_PUBLISHABLE_KEY');

/** Secret used to verify inbound webhook signatures (whsec_…). */
export const stripeWebhookSecret = (): string =>
  optionalEnv('STRIPE_WEBHOOK_SECRET');
