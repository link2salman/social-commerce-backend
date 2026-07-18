import { Router } from 'express';
import * as orderController from '@controllers/orderController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { checkoutIntentSchema } from '@validators/cartValidators';

const router = Router();

// Literals before the ':id' route.
router.post(
  '/intent',
  protect,
  validateBody(checkoutIntentSchema),
  orderController.createIntent
);
router.get('/', protect, orderController.list);
router.post('/:id/confirm', protect, orderController.confirm);
router.get('/:id', protect, orderController.detail);

export default router;
