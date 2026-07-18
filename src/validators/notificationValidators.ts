import { z } from 'zod';

// POST /notifications/read — mark notifications read. No body (or empty ids) =
// mark ALL unread; a non-empty ids list marks only those. Bounded so a client
// can't submit an unbounded id array.
export const markReadSchema = z.object({
  ids: z.array(z.string().uuid()).max(200).optional(),
});

export type MarkReadBody = z.infer<typeof markReadSchema>;
