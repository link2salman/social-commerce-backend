import { z } from 'zod';
import { DEVICE_PLATFORMS } from '@constants/enums';

// POST /devices — register this device's FCM token for push.
export const registerDeviceSchema = z.object({
  token: z.string().min(1).max(4096),
  platform: z.enum(DEVICE_PLATFORMS),
});

// DELETE /devices — unregister on logout.
export const unregisterDeviceSchema = z.object({
  token: z.string().min(1).max(4096),
});

export type RegisterDeviceBody = z.infer<typeof registerDeviceSchema>;
export type UnregisterDeviceBody = z.infer<typeof unregisterDeviceSchema>;
