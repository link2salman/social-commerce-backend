import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendList, sendSuccess } from '@utils/responseHandler';
import { NotFoundError } from '@middlewares/error';
import { requireUserId } from '@middlewares/auth';
import {
  registerSeller,
  getSellerForUser,
  listMyProducts,
} from '@services/productService';
import {
  listSellerOrders,
  fulfillOrder,
  markOrderDelivered,
} from '@services/fulfillmentService';
import { serializeSeller } from '@serializers/sellerSerializer';
import type { BecomeSellerBody } from '@validators/productValidators';
import type { FulfillOrderBody } from '@validators/cartValidators';

const orderId = (req: Request): string => req.params.id as string;

// POST /v1/sellers { name } → { data: Seller } (201) — register the caller.
export const become = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const seller = await registerSeller(userId, (req.body as BecomeSellerBody).name);
  sendSuccess(res, 'Seller profile created', serializeSeller(seller, userId), 201);
});

// GET /v1/sellers/me → { data: Seller } (404 if no seller profile yet).
export const me = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const seller = await getSellerForUser(userId);
  if (!seller) throw new NotFoundError('Seller profile');
  sendSuccess(res, 'Seller profile fetched', serializeSeller(seller, userId));
});

// GET /v1/sellers/me/products → { items } — the caller's own catalog.
export const myProducts = asyncHandler(async (req: Request, res: Response) => {
  const result = await listMyProducts(requireUserId(req));
  sendList(res, 'Products fetched', result.items);
});

// GET /v1/sellers/me/orders → { items } — paid orders with the caller's products.
export const myOrders = asyncHandler(async (req: Request, res: Response) => {
  const result = await listSellerOrders(requireUserId(req));
  sendList(res, 'Orders fetched', result.items);
});

// POST /v1/sellers/me/orders/:id/fulfill { tracking_number?, carrier? }
//   → { data: SellerOrder }
export const fulfill = asyncHandler(async (req: Request, res: Response) => {
  const order = await fulfillOrder(
    requireUserId(req),
    orderId(req),
    req.body as FulfillOrderBody
  );
  sendSuccess(res, 'Order marked shipped', order);
});

// POST /v1/sellers/me/orders/:id/deliver → { data: SellerOrder }
export const deliver = asyncHandler(async (req: Request, res: Response) => {
  const order = await markOrderDelivered(requireUserId(req), orderId(req));
  sendSuccess(res, 'Order marked delivered', order);
});
