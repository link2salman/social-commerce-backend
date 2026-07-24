import { Router } from 'express';
import * as sellerController from '@controllers/sellerController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { becomeSellerSchema } from '@validators/productValidators';
import { fulfillOrderSchema } from '@validators/cartValidators';

const router = Router();

// Literal `/me*` routes are distinct from any future `/:id`, so ordering is safe.
router.post('/', protect, validateBody(becomeSellerSchema), sellerController.become);
router.get('/me', protect, sellerController.me);
router.get('/me/products', protect, sellerController.myProducts);

// Seller order fulfillment.
router.get('/me/orders', protect, sellerController.myOrders);
router.post(
  '/me/orders/:id/fulfill',
  protect,
  validateBody(fulfillOrderSchema),
  sellerController.fulfill
);
router.post('/me/orders/:id/deliver', protect, sellerController.deliver);

export default router;
