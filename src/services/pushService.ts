import DeviceToken from '@models/user/DeviceToken';
import { getFirebaseMessaging } from '@config/firebase';
import logger from '@utils/logger';

// Sends FCM push to every device a user has registered. Callers use this
// fire-and-forget (it never throws) so a push failure can't break the request
// that triggered it. A no-op when FCM isn't configured or the user has no tokens.

export interface PushPayload {
  title: string;
  body: string;
  /** FCM data payload — deep-link target the app routes on tap. Values are strings. */
  data?: Record<string, string>;
}

const STALE_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export const sendToUser = async (
  userId: string,
  payload: PushPayload
): Promise<void> => {
  const messaging = getFirebaseMessaging();
  if (!messaging) return;

  const rows = await DeviceToken.findAll({
    where: { user_id: userId },
    attributes: ['token'],
  });
  if (rows.length === 0) return;
  const tokens = rows.map(r => r.token);

  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data ?? {},
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    // Prune tokens FCM rejected as dead so the table stays clean.
    const stale = res.responses.flatMap((r, i) =>
      !r.success && r.error && STALE_TOKEN_ERRORS.has(r.error.code)
        ? [tokens[i]!]
        : []
    );
    if (stale.length > 0) {
      await DeviceToken.destroy({ where: { token: stale } });
    }
  } catch (err) {
    logger.error({ err, userId }, 'push send failed');
  }
};

export const sendToUsers = async (
  userIds: string[],
  payload: PushPayload
): Promise<void> => {
  await Promise.all(userIds.map(id => sendToUser(id, payload)));
};
