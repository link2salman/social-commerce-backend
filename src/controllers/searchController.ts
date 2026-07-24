import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import { searchProducts } from '@services/productService';
import { searchVideos } from '@services/videoService';
import { searchUsers } from '@services/socialService';
import type { SearchQuery } from '@validators/searchValidators';

// GET /v1/search?type=products|videos|users&q= → { items }
// One discovery surface over the three searchable collections. Each branch
// returns the same `{ items }` envelope its dedicated list already uses, so a
// client renders results with the card it already has for that type.
export const search = asyncHandler(async (req: Request, res: Response) => {
  const { type, q } = req.validatedQuery as SearchQuery;
  const viewerId = requireUserId(req);

  const result =
    type === 'products'
      ? await searchProducts(q)
      : type === 'videos'
        ? await searchVideos(viewerId, q)
        : await searchUsers(viewerId, q);

  send(res, result);
});
