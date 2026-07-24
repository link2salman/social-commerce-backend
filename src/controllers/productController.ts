import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send, sendOk } from '@utils/respond';
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

// GET /v1/products → { items: Product[] }
export const list = asyncHandler(async (_req: Request, res: Response) => {
  send(res, await listProducts());
});

// GET /v1/products/:id → Product
export const get = asyncHandler(async (req: Request, res: Response) => {
  send(res, await getProduct(req.params.id as string));
});

// POST /v1/products → Product (201) — seller only; prices in dollars.
export const create = asyncHandler(async (req: Request, res: Response) => {
  const product = await createProductForUser(
    requireUserId(req),
    req.body as CreateProductBody
  );
  send(res, product, 201);
});

// PATCH /v1/products/:id → Product — owner only; partial update.
export const update = asyncHandler(async (req: Request, res: Response) => {
  const product = await updateProductForUser(
    requireUserId(req),
    req.params.id as string,
    req.body as UpdateProductBody
  );
  send(res, product);
});

// DELETE /v1/products/:id → { ok: true } — owner only; soft-delete.
export const remove = asyncHandler(async (req: Request, res: Response) => {
  await deleteProductForUser(requireUserId(req), req.params.id as string);
  sendOk(res);
});
