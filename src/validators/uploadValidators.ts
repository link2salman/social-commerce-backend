import { z } from 'zod';
import { UPLOAD_KINDS } from '@constants/media';

// POST /uploads/sign — the client asks for a signed URL to upload one asset to.
// `kind` picks the storage path prefix, the accepted content types and the size
// ceiling; `content_type` picks the file extension.
//
// `content_length` is the file's exact size in bytes and it is REQUIRED: the
// service signs it into the presigned URL, so S3 itself refuses a PUT of any
// other size (see storageService.createSignedUpload for why a presigned PUT
// admits no other bound).
//
// Only the SHAPE is checked here. Both ceilings — which content types a kind
// accepts, and how many bytes it may carry — are business rules that live in the
// service, so a refusal carries UNSUPPORTED_MEDIA_TYPE / UPLOAD_TOO_LARGE rather
// than a generic VALIDATION_FAILED the app cannot write copy for.
export const signUploadSchema = z.object({
  kind: z.enum(UPLOAD_KINDS),
  content_type: z.string().min(3).max(100),
  content_length: z.number().int().positive(),
});

export type SignUploadBody = z.infer<typeof signUploadSchema>;
