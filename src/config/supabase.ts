import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { optionalEnv } from '@utils/env';
import logger from '@utils/logger';

// Supabase Storage is OPTIONAL at boot (like Stripe): the server runs without it,
// but upload endpoints return 503 until SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// are set. We use the SERVICE ROLE key here (server-side only, never shipped to
// the app) to mint short-lived signed upload URLs the client PUTs directly to.
//
// This is the same Supabase project that already hosts Postgres — no new account.

let client: SupabaseClient | null = null;
let initialized = false;

export const getSupabase = (): SupabaseClient | null => {
  if (initialized) return client;
  initialized = true;

  const url = optionalEnv('SUPABASE_URL');
  const key = optionalEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    logger.warn(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — upload endpoints will return 503.'
    );
    return null;
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  logger.info('Supabase Storage initialized.');
  return client;
};

export const isStorageConfigured = (): boolean => getSupabase() !== null;

/** Single public bucket that holds every uploaded asset (path-prefixed by kind). */
export const storageBucket = (): string =>
  optionalEnv('SUPABASE_STORAGE_BUCKET', 'media');
