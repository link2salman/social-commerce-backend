import { Router } from 'express';
import * as moderationController from '@controllers/moderationController';
import { protect, requireAdmin } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { resolveReportSchema } from '@validators/moderationValidators';

// The /admin surface. Every route is protect → requireAdmin: an anonymous
// request 401s at protect, a signed-in non-moderator 403s at requireAdmin. The
// mobile app never calls these — this is a moderation console's API.
const router = Router();

router.use(protect, requireAdmin);

// Literal route before the :id param route.
router.post('/reports/resolve', validateBody(resolveReportSchema), moderationController.resolve);
router.get('/reports', moderationController.list);
router.get('/reports/:id', moderationController.detail);

export default router;
