import { z } from 'zod';
import { POST_MEDIA_TYPES } from '@constants/enums';
import { MAX_VIDEO_DURATION_MS } from '@constants/media';

// A single post attachment: an image or a video. The URLs point at objects the
// client already uploaded to storage (same model as video publish). A video may
// carry its own poster + duration; the service fills a placeholder poster if not.
const mediaItemSchema = z.object({
  type: z.enum(POST_MEDIA_TYPES),
  url: z.string().url(),
  thumbnail_url: z.string().url().nullable().optional(),
  // Same ceiling as POST /videos: a post's video attachment goes through the
  // identical upload + transcode path (`post_media_transcode`), so leaving it
  // unbounded here would just move the three-hour clip one endpoint over.
  duration_ms: z
    .number()
    .int()
    .positive()
    .max(MAX_VIDEO_DURATION_MS)
    .nullable()
    .optional(),
});

// POST /posts — create a text/image/video post. A post must carry SOMETHING:
// non-empty text or at least one media item — an empty post is a 400.
export const createPostSchema = z
  .object({
    body: z.string().trim().max(2000).default(''),
    media: z.array(mediaItemSchema).max(10).default([]),
  })
  .refine(v => v.body.length > 0 || v.media.length > 0, {
    message: 'A post needs text or at least one image or video',
    path: ['body'],
  });

export type CreatePostBody = z.infer<typeof createPostSchema>;
