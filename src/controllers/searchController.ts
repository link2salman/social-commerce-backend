import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendList } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import { searchProducts } from '@services/productService';
import { searchVideos } from '@services/videoService';
import { searchUsers } from '@services/socialService';
import type { SearchQuery } from '@validators/searchValidators';

// GET /v1/search?type=products|videos|users&q= → { items }
// One discovery surface over the three searchable collections. Each branch
// returns the same `{ items }` list its dedicated endpoint already uses, so a
// client renders results with the card it already has for that type.
export const search = asyncHandler(async (req: Request, res: Response) => {
  const { type, q } = req.validatedQuery as SearchQuery;
  const viewerId = requireUserId(req);

  // The union of the three item types has to be widened before it reaches
  // sendList: TS resolves the generic against the FIRST branch otherwise and
  // rejects the other two. The wire shape is identical either way — `items` is
  // whatever card the requested `type` renders.
  const result: { items: unknown[] } =
    type === 'products'
      ? await searchProducts(q)
      : type === 'videos'
        ? await searchVideos(viewerId, q)
        : await searchUsers(viewerId, q);

  sendList(res, 'Search results fetched', result.items);
});
