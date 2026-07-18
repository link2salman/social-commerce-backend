import { Router } from 'express';
import * as uploadController from '@controllers/uploadController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { signUploadSchema } from '@validators/uploadValidators';

const router = Router();

router.post(
  '/sign',
  protect,
  validateBody(signUploadSchema),
  uploadController.signUpload
);

export default router;
