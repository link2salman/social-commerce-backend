import { z } from 'zod';
import { MAX_VIDEO_DURATION_MS } from '@constants/media';

// POST /videos — publish a recorded video. The media URLs point at objects the
// client already uploaded to storage. thumbnail_url is optional (a poster is
// generated server-side when absent). product_ids tag the video as shoppable.
export const createVideoSchema = z.object({
  video_url: z.string().url(),
  thumbnail_url: z.string().url().nullable().default(null),
  caption: z.string().max(2200).default(''),
  // Bounded, because this is a short-form feed and the client's recording cap is
  // only a UI courtesy — `duration_ms` arrives from the client, and an unbounded
  // one meant a three-hour clip published fine. See constants/media.ts for the
  // headroom over the app's 60s cap and the env var that tunes it.
  duration_ms: z.number().int().positive().max(MAX_VIDEO_DURATION_MS),
  sound_name: z.string().max(160).nullable().default(null),
  // The camera filter the clip was shot with ('none' | 'vivid' | 'warm' | …).
  // Length-bounded only, NOT an enum: the app owns the filter list
  // (features/camera/store/cameraStore.ts), and shipping a new filter there
  // must not require a backend deploy. The bound matches videos.filter_id's
  // VARCHAR(32) so an over-long value is a 400, not a DB error.
  filter_id: z.string().max(32).nullable().default(null),
  product_ids: z.array(z.string().uuid()).max(10).default([]),
});

export type CreateVideoBody = z.infer<typeof createVideoSchema>;
