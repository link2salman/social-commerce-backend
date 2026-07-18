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
  productIds: z.array(z.string().uuid()).max(10).default([]),
});

export type CreateVideoBody = z.infer<typeof createVideoSchema>;
