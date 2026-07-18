import { Router } from 'express';
import * as orderController from '@controllers/orderController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { checkoutSchema } from '@validators/cartValidators';

const router = Router();

router.post('/', protect, validateBody(checkoutSchema), orderController.create);
router.get('/', protect, orderController.list);
router.get('/:id', protect, orderController.detail);

export default router;
