import { Router } from 'express';
import * as orderController from '@controllers/orderController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { cartSummarySchema } from '@validators/cartValidators';

const router = Router();

router.post(
  '/summary',
  protect,
  validateBody(cartSummarySchema),
  orderController.cartSummary
);

export default router;
