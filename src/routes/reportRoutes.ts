import { Router } from 'express';
import * as reportController from '@controllers/reportController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { reportSchema } from '@validators/reportValidators';

const router = Router();

router.post('/', protect, validateBody(reportSchema), reportController.create);

export default router;
