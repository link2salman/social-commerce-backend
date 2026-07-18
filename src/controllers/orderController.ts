import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import { priceCart } from '@services/pricingService';
import {
  createOrder,
  listOrders,
  getOrderDetail,
} from '@services/orderService';
import type {
  CartSummaryBody,
  CheckoutBody,
} from '@validators/cartValidators';

// POST /v1/cart/summary { items } → CartSummary (server-authoritative pricing)
export const cartSummary = asyncHandler(async (req: Request, res: Response) => {
  const { items } = req.body as CartSummaryBody;
  const priced = await priceCart(items);
  send(res, priced.summary);
});

// POST /v1/orders { items, paymentToken } → Order (201)
export const create = asyncHandler(async (req: Request, res: Response) => {
  const { items, paymentToken } = req.body as CheckoutBody;
  const order = await createOrder(requireUserId(req), items, paymentToken);
  send(res, order, 201);
});

// GET /v1/orders → { items: Order[] } (newest first)
export const list = asyncHandler(async (req: Request, res: Response) => {
  send(res, await listOrders(requireUserId(req)));
});

// GET /v1/orders/:id → OrderDetail
export const detail = asyncHandler(async (req: Request, res: Response) => {
  send(res, await getOrderDetail(requireUserId(req), req.params.id as string));
});
