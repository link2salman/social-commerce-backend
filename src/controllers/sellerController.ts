import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
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

// POST /v1/sellers { name } → Seller (201) — register the caller as a seller.
export const become = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const seller = await registerSeller(userId, (req.body as BecomeSellerBody).name);
  send(res, serializeSeller(seller, userId), 201);
});

// GET /v1/sellers/me → Seller (404 if the caller has no seller profile yet).
export const me = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const seller = await getSellerForUser(userId);
  if (!seller) throw new NotFoundError('Seller profile');
  send(res, serializeSeller(seller, userId));
});

// GET /v1/sellers/me/products → { items } — the caller's own catalog (management).
export const myProducts = asyncHandler(async (req: Request, res: Response) => {
  send(res, await listMyProducts(requireUserId(req)));
});

// GET /v1/sellers/me/orders → { items } — paid orders containing the caller's products.
export const myOrders = asyncHandler(async (req: Request, res: Response) => {
  send(res, await listSellerOrders(requireUserId(req)));
});

// POST /v1/sellers/me/orders/:id/fulfill { trackingNumber?, carrier? } → SellerOrder
export const fulfill = asyncHandler(async (req: Request, res: Response) => {
  const order = await fulfillOrder(
    requireUserId(req),
    orderId(req),
    req.body as FulfillOrderBody
  );
  send(res, order);
});

// POST /v1/sellers/me/orders/:id/deliver → SellerOrder
export const deliver = asyncHandler(async (req: Request, res: Response) => {
  send(res, await markOrderDelivered(requireUserId(req), orderId(req)));
});
