import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendOk } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import { registerDevice, unregisterDevice } from '@services/deviceService';
import type {
  RegisterDeviceBody,
  UnregisterDeviceBody,
} from '@validators/deviceValidators';

// POST /v1/devices { token, platform } → { ok: true }
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { token, platform } = req.body as RegisterDeviceBody;
  await registerDevice(requireUserId(req), token, platform);
  sendOk(res, 201);
});

// DELETE /v1/devices { token } → { ok: true }
export const unregister = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body as UnregisterDeviceBody;
  await unregisterDevice(requireUserId(req), token);
  sendOk(res);
});
