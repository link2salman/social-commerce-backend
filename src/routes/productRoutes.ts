import { Router } from 'express';
import * as productController from '@controllers/productController';
import { protect } from '@middlewares/auth';

const router = Router();

router.get('/', protect, productController.list);
router.get('/:id', protect, productController.get);

export default router;
