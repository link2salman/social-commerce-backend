import { z } from 'zod';

// POST /posts — create an image/text post. `imageUrls` point at objects the
// client already uploaded to storage (same model as video publish). A post must
// carry SOMETHING: non-empty text or at least one image — an empty post is a 400.
export const createPostSchema = z
  .object({
    body: z.string().trim().max(2000).default(''),
    imageUrls: z.array(z.string().url()).max(10).default([]),
  })
  .refine(v => v.body.length > 0 || v.imageUrls.length > 0, {
    message: 'A post needs text or at least one image',
    path: ['body'],
  });

export type CreatePostBody = z.infer<typeof createPostSchema>;
