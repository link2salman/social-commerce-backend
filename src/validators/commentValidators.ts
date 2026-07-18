import { z } from 'zod';

// POST videos/:id/comments — the client sends { body, parentId? } (a top-level
// comment when parentId is null, a reply otherwise). Mirrors comment.schema.ts.
export const commentPostSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(500),
  parentId: z.string().uuid().nullable().optional().default(null),
});

export type CommentPostBody = z.infer<typeof commentPostSchema>;
