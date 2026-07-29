import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendList, sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import {
  listProducts,
  getProduct,
  createProductForUser,
  updateProductForUser,
  deleteProductForUser,
} from '@services/productService';
import type {
  CreateProductBody,
  UpdateProductBody,
} from '@validators/productValidators';

// GET /v1/products → { items }
export const list = asyncHandler(async (_req: Request, res: Response) => {
  const result = await listProducts();
  sendList(res, 'Products fetched', result.items);
});

// GET /v1/products/:id → { data: Product }
export const get = asyncHandler(async (req: Request, res: Response) => {
  const product = await getProduct(req.params.id as string);
  sendSuccess(res, 'Product fetched', product);
});

// POST /v1/products → { data: Product } (201) — seller only; prices in dollars.
export const create = asyncHandler(async (req: Request, res: Response) => {
  const product = await createProductForUser(
    requireUserId(req),
    req.body as CreateProductBody
  );
  sendSuccess(res, 'Product created', product, 201);
});

// PATCH /v1/products/:id → { data: Product } — owner only; partial update.
export const update = asyncHandler(async (req: Request, res: Response) => {
  const product = await updateProductForUser(
    requireUserId(req),
    req.params.id as string,
    req.body as UpdateProductBody
  );
  sendSuccess(res, 'Product updated', product);
});

// DELETE /v1/products/:id — owner only; soft-delete.
export const remove = asyncHandler(async (req: Request, res: Response) => {
  await deleteProductForUser(requireUserId(req), req.params.id as string);
  sendSuccess(res, 'Product deleted');
});
