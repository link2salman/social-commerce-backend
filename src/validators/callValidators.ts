import { z } from 'zod';
import { CALL_DIRECTIONS, CALL_OUTCOMES } from '@constants/enums';

// A participant snapshot as the client captured it. `username` is bounded to
// the column width (and the signup rule's own 24-char limit) so an over-long
// handle is a clean 400 rather than a VARCHAR overflow 500 — and so the JSONB
// participants array can't be used to store unbounded text.
const callPeerSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(1).max(24),
  avatarUrl: z.string().url().nullable(),
});

/** A group call can't ring nobody, and shouldn't be an unbounded write. */
const MAX_PARTICIPANTS = 64;

// POST /calls — mirrors the app's CallRecordInputSchema (CallRecordSchema
// without id). `isGroup`/`participants` default so a client build that predates
// group-call history keeps posting 1:1 records unchanged.
export const callRecordSchema = z
  .object({
    peer: callPeerSchema.nullable().default(null),
    isGroup: z.boolean().default(false),
    participants: z.array(callPeerSchema).max(MAX_PARTICIPANTS).default([]),
    direction: z.enum(CALL_DIRECTIONS),
    isVideo: z.boolean(),
    outcome: z.enum(CALL_OUTCOMES),
    startedAt: z.string(),
    durationSec: z.number().int().nonnegative(),
  })
  .superRefine((v, ctx) => {
    // Exactly one shape, matching the DB CHECK constraint. Enforced here too so
    // the client gets a field-level 400 instead of a constraint-violation 500.
    if (v.isGroup) {
      if (v.peer !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['peer'],
          message: 'A group call has no single peer — send peer: null.',
        });
      }
      if (v.participants.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['participants'],
          message: 'A group call must list its participants.',
        });
      }
      return;
    }
    if (v.peer === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['peer'],
        message: 'A 1:1 call requires a peer.',
      });
    }
    if (v.participants.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participants'],
        message: 'A 1:1 call carries its other side in peer, not participants.',
      });
    }
  });

export type CallRecordBody = z.infer<typeof callRecordSchema>;
