import { z } from 'zod';

// POST /videos — publish a recorded video. The media URLs point at objects the
// client already uploaded to storage. thumbnailUrl is optional (a poster is
// generated server-side when absent). productIds tag the video as shoppable.
export const createVideoSchema = z.object({
  videoUrl: z.string().url(),
  thumbnailUrl: z.string().url().nullable().default(null),
  caption: z.string().max(2200).default(''),
  durationMs: z.number().int().positive(),
  soundName: z.string().max(160).nullable().default(null),
  // The camera filter the clip was shot with ('none' | 'vivid' | 'warm' | …).
  // Length-bounded only, NOT an enum: the app owns the filter list
  // (features/camera/store/cameraStore.ts), and shipping a new filter there
  // must not require a backend deploy. The bound matches videos.filter_id's
  // VARCHAR(32) so an over-long value is a 400, not a DB error.
  filterId: z.string().max(32).nullable().default(null),
  productIds: z.array(z.string().uuid()).max(10).default([]),
});

export type CreateVideoBody = z.infer<typeof createVideoSchema>;
