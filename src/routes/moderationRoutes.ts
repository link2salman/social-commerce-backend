import { Router } from 'express';
import * as moderationController from '@controllers/moderationController';
import * as appealController from '@controllers/appealController';
import * as orderController from '@controllers/orderController';
import { protect, requireAdmin } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { resolveReportSchema } from '@validators/moderationValidators';
import { resolveAppealSchema } from '@validators/appealValidators';

// The /admin surface. Every route is protect → requireAdmin: an anonymous
// request 401s at protect, a signed-in non-moderator 403s at requireAdmin. The
// mobile app never calls these — this is a moderation/operator console's API.
const router = Router();

router.use(protect, requireAdmin);

// Literal route before the :id param route.
router.post('/reports/resolve', validateBody(resolveReportSchema), moderationController.resolve);
router.get('/reports', moderationController.list);
router.get('/reports/:id', moderationController.detail);

// Appeals queue — the counterpart to reports (users contesting decisions).
router.post('/appeals/resolve', validateBody(resolveAppealSchema), appealController.resolve);
router.get('/appeals', appealController.list);
router.get('/appeals/:id', appealController.detail);

// Operator refund. Lives on /admin (not /orders) because a refund is an operator
// action, not one an order's owner performs.
router.post('/orders/:id/refund', orderController.adminRefund);

export default router;
