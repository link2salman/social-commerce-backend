import {
  initializeApp,
  cert,
  getApps,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { optionalEnv } from '@utils/env';
import logger from '@utils/logger';

// Firebase Admin (FCM) is OPTIONAL. Push sending is a no-op until a service
// account is provided. The whole service account JSON is passed as ONE env value,
// base64-encoded (FCM_SERVICE_ACCOUNT_BASE64), so there's no file to mount:
//   base64 -i service-account.json   → paste the output as the env value.

let messaging: Messaging | null = null;
let initialized = false;

export const getFirebaseMessaging = (): Messaging | null => {
  if (initialized) return messaging;
  initialized = true;

  const b64 = optionalEnv('FCM_SERVICE_ACCOUNT_BASE64');
  if (!b64) {
    logger.warn(
      'FCM_SERVICE_ACCOUNT_BASE64 not set — push notifications disabled.'
    );
    return null;
  }
  try {
    const json = JSON.parse(
      Buffer.from(b64, 'base64').toString('utf8')
    ) as ServiceAccount;
    const app: App = getApps().length
      ? getApps()[0]!
      : initializeApp({ credential: cert(json) });
    messaging = getMessaging(app);
    logger.info(
      'Firebase Admin (FCM) initialized — push notifications enabled.'
    );
    return messaging;
  } catch (err) {
    logger.error({ err }, 'Failed to init Firebase Admin — push disabled.');
    return null;
  }
};

export const isPushConfigured = (): boolean => getFirebaseMessaging() !== null;
