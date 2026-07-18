import { Router } from 'express';
import * as callController from '@controllers/callController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { callRecordSchema } from '@validators/callValidators';

const router = Router();

// Literal before none needed here, but keep ice-servers above the bare routes.
router.get('/ice-servers', protect, callController.iceServers);
router.get('/', protect, callController.list);
router.post('/', protect, validateBody(callRecordSchema), callController.record);

export default router;
