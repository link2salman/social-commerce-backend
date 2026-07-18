import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import { priceCart } from '@services/pricingService';
import {
  createCheckoutIntent,
  confirmOrder,
  listOrders,
  getOrderDetail,
} from '@services/orderService';
import type {
  CartSummaryBody,
  CheckoutIntentBody,
} from '@validators/cartValidators';

// POST /v1/cart/summary { items } → CartSummary (server-authoritative pricing)
export const cartSummary = asyncHandler(async (req: Request, res: Response) => {
  const { items } = req.body as CartSummaryBody;
  const priced = await priceCart(items);
  send(res, priced.summary);
});

// POST /v1/orders/intent { items } → { order, provider, clientSecret, … } (201)
// Creates the order (unpaid) and opens a Stripe PaymentIntent.
export const createIntent = asyncHandler(
  async (req: Request, res: Response) => {
    const { items } = req.body as CheckoutIntentBody;
    const intent = await createCheckoutIntent(requireUserId(req), items);
    send(res, intent, 201);
  }
);

// POST /v1/orders/:id/confirm → Order — finalize after the PaymentSheet succeeds.
export const confirm = asyncHandler(async (req: Request, res: Response) => {
  const order = await confirmOrder(requireUserId(req), req.params.id as string);
  send(res, order);
});

// GET /v1/orders → { items: Order[] } (newest first)
export const list = asyncHandler(async (req: Request, res: Response) => {
  send(res, await listOrders(requireUserId(req)));
});

// GET /v1/orders/:id → OrderDetail
export const detail = asyncHandler(async (req: Request, res: Response) => {
  send(res, await getOrderDetail(requireUserId(req), req.params.id as string));
});
