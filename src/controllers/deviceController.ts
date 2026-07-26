import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import { registerDevice, unregisterDevice } from '@services/deviceService';
import type {
  RegisterDeviceBody,
  UnregisterDeviceBody,
} from '@validators/deviceValidators';

// POST /v1/devices { token, platform } → 201
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { token, platform } = req.body as RegisterDeviceBody;
  await registerDevice(requireUserId(req), token, platform);
  sendSuccess(res, 'Device registered', undefined, 201);
});

// DELETE /v1/devices { token }
export const unregister = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body as UnregisterDeviceBody;
  await unregisterDevice(requireUserId(req), token);
  sendSuccess(res, 'Device unregistered');
});
