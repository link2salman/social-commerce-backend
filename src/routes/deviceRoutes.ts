import { Router } from 'express';
import * as deviceController from '@controllers/deviceController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import {
  registerDeviceSchema,
  unregisterDeviceSchema,
} from '@validators/deviceValidators';

const router = Router();

router.post(
  '/',
  protect,
  validateBody(registerDeviceSchema),
  deviceController.register
);
router.delete(
  '/',
  protect,
  validateBody(unregisterDeviceSchema),
  deviceController.unregister
);

export default router;
