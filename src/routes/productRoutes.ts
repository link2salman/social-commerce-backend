import { Router } from 'express';
import * as productController from '@controllers/productController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import {
  createProductSchema,
  updateProductSchema,
} from '@validators/productValidators';

const router = Router();

router.get('/', protect, productController.list);
router.post('/', protect, validateBody(createProductSchema), productController.create);
router.get('/:id', protect, productController.get);
router.patch('/:id', protect, validateBody(updateProductSchema), productController.update);
router.delete('/:id', protect, productController.remove);

export default router;
