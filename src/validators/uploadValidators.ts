import { z } from 'zod';

// POST /uploads/sign — the client asks for a signed URL to upload one asset to.
// `kind` picks the storage path prefix; `content_type` picks the file extension.
export const signUploadSchema = z.object({
  kind: z.enum(['video', 'image', 'avatar', 'chat']),
  content_type: z.string().min(3).max(100),
});

export type SignUploadBody = z.infer<typeof signUploadSchema>;
