import { Router } from 'express';
import * as appealController from '@controllers/appealController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { appealSchema, suspensionAppealSchema } from '@validators/appealValidators';

const router = Router();

// Literal /suspension before the bare POST. It is deliberately UNAUTHENTICATED:
// a suspended user is locked out of a session, so they prove identity with
// credentials in the body (appealService.createSuspensionAppeal).
router.post('/suspension', validateBody(suspensionAppealSchema), appealController.createSuspension);

// Authenticated appeal (in practice: a removed video). protect populates req.user.
router.post('/', protect, validateBody(appealSchema), appealController.create);

export default router;
