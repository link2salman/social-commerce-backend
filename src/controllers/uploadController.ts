import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import { createSignedUpload } from '@services/storageService';
import type { SignUploadBody } from '@validators/uploadValidators';

// POST /v1/uploads/sign { kind, content_type, content_length }
//   → { data: { upload_url, path, public_url } } (201)
// The client PUTs the file to upload_url, then persists public_url on the
// resource it creates (a video, an avatar, a chat image).
//
// `content_length` is the exact byte size of the file about to be PUT: it is
// checked against the ceiling for `kind` and then signed into the URL, so the
// URL is only usable for a file of that size.
export const signUpload = asyncHandler(async (req: Request, res: Response) => {
  const { kind, content_type, content_length } = req.body as SignUploadBody;
  const signed = await createSignedUpload(
    requireUserId(req),
    kind,
    content_type,
    content_length
  );
  sendSuccess(res, 'Upload URL issued', signed, 201);
});
