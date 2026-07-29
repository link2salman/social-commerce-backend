import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import { createSignedUpload } from '@services/storageService';
import type { SignUploadBody } from '@validators/uploadValidators';

// POST /v1/uploads/sign { kind, content_type }
//   → { data: { upload_url, path, public_url } } (201)
// The client PUTs the file to upload_url, then persists public_url on the
// resource it creates (a video, an avatar, a chat image).
export const signUpload = asyncHandler(async (req: Request, res: Response) => {
  const { kind, content_type } = req.body as SignUploadBody;
  const signed = await createSignedUpload(requireUserId(req), kind, content_type);
  sendSuccess(res, 'Upload URL issued', signed, 201);
});
