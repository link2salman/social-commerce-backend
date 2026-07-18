import DeviceToken from '@models/user/DeviceToken';
import type { DevicePlatform } from '@constants/enums';

// A push token is globally unique. If it already exists (a device that re-logs-in
// as a different user), reassign it to the current user rather than erroring.
export const registerDevice = async (
  userId: string,
  token: string,
  platform: DevicePlatform
): Promise<void> => {
  const existing = await DeviceToken.findOne({ where: { token } });
  if (existing) {
    if (existing.user_id !== userId || existing.platform !== platform) {
      await existing.update({ user_id: userId, platform });
    }
    return;
  }
  await DeviceToken.create({ user_id: userId, token, platform });
};

// Called on logout so a signed-out device stops receiving the user's pushes.
export const unregisterDevice = async (
  userId: string,
  token: string
): Promise<void> => {
  await DeviceToken.destroy({ where: { token, user_id: userId } });
};
