import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendList, sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import { priceCart } from '@services/pricingService';
import {
  createCheckoutIntent,
  confirmOrder,
  listOrders,
  getOrderDetail,
  refundOrder,
} from '@services/orderService';
import type {
  CartSummaryBody,
  CheckoutIntentBody,
} from '@validators/cartValidators';

// POST /v1/cart/summary { items } → { data: CartSummary } (server-authoritative)
export const cartSummary = asyncHandler(async (req: Request, res: Response) => {
  const { items } = req.body as CartSummaryBody;
  const priced = await priceCart(items);
  sendSuccess(res, 'Cart priced', priced.summary);
});

// POST /v1/orders/intent { items, shipping_address? } → { data: CheckoutIntent } (201)
// Creates the order (unpaid) and opens a Stripe PaymentIntent.
export const createIntent = asyncHandler(
  async (req: Request, res: Response) => {
    const { items, shipping_address } = req.body as CheckoutIntentBody;
    const intent = await createCheckoutIntent(
      requireUserId(req),
      items,
      shipping_address ?? null
    );
    sendSuccess(res, 'Checkout started', intent, 201);
  }
);

// POST /v1/orders/:id/confirm → { data: Order } — finalize after the PaymentSheet.
export const confirm = asyncHandler(async (req: Request, res: Response) => {
  const order = await confirmOrder(requireUserId(req), req.params.id as string);
  sendSuccess(res, 'Order confirmed', order);
});

// GET /v1/orders → { items } (newest first)
export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await listOrders(requireUserId(req));
  sendList(res, 'Orders fetched', result.items);
});

// GET /v1/orders/:id → { data: OrderDetail }
export const detail = asyncHandler(async (req: Request, res: Response) => {
  const order = await getOrderDetail(
    requireUserId(req),
    req.params.id as string
  );
  sendSuccess(res, 'Order fetched', order);
});

// POST /v1/admin/orders/:id/refund → { data: Order } (admin-gated; refunds the
// charge and marks the order refunded). Mounted under the /admin surface, not
// /orders, because a refund is an operator action, not something an owner does.
export const adminRefund = asyncHandler(async (req: Request, res: Response) => {
  const order = await refundOrder(req.params.id as string);
  sendSuccess(res, 'Order refunded', order);
});
