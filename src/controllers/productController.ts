import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
import { listProducts, getProduct } from '@services/productService';

// GET /v1/products → { items: Product[] }
export const list = asyncHandler(async (_req: Request, res: Response) => {
  send(res, await listProducts());
});

// GET /v1/products/:id → Product
export const get = asyncHandler(async (req: Request, res: Response) => {
  send(res, await getProduct(req.params.id as string));
});
