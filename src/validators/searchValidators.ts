import { z } from 'zod';

// GET /search?type=&q= — one discovery endpoint over three collections. `q` is
// optional (an empty query returns no items, same as people search); `type`
// picks the collection and is required (an unknown type is a 400).
export const searchQuerySchema = z.object({
  type: z.enum(['products', 'videos', 'users']),
  q: z.string().trim().max(100).optional().default(''),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
