import { z } from 'zod';
import { CALL_DIRECTIONS, CALL_OUTCOMES } from '@constants/enums';

// POST /calls — mirrors CallRecordInputSchema (CallRecordSchema without id).
export const callRecordSchema = z.object({
  peer: z.object({
    id: z.string().uuid(),
    username: z.string(),
    avatarUrl: z.string().url().nullable(),
  }),
  direction: z.enum(CALL_DIRECTIONS),
  isVideo: z.boolean(),
  outcome: z.enum(CALL_OUTCOMES),
  startedAt: z.string(),
  durationSec: z.number().int().nonnegative(),
});

export type CallRecordBody = z.infer<typeof callRecordSchema>;
