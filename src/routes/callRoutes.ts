import { Router } from 'express';
import * as callController from '@controllers/callController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { callRecordSchema } from '@validators/callValidators';

const router = Router();

router.get('/', protect, callController.list);
router.post('/', protect, validateBody(callRecordSchema), callController.record);

export default router;
