import { z } from 'zod';

// POST videos/:id/comments — the client sends { body, parent_id? } (a top-level
// comment when parent_id is null, a reply otherwise). Mirrors comment.schema.ts.
export const commentPostSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(500),
  parent_id: z.string().uuid().nullable().optional().default(null),
});

export type CommentPostBody = z.infer<typeof commentPostSchema>;
