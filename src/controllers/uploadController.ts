import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import { createSignedUpload } from '@services/storageService';
import type { SignUploadBody } from '@validators/uploadValidators';

// POST /v1/uploads/sign { kind, contentType } → { uploadUrl, path, publicUrl }
// The client PUTs the file to uploadUrl, then persists publicUrl on the resource
// it creates (a video, an avatar, a chat image).
export const signUpload = asyncHandler(async (req: Request, res: Response) => {
  const { kind, contentType } = req.body as SignUploadBody;
  const signed = await createSignedUpload(requireUserId(req), kind, contentType);
  send(res, signed, 201);
});
