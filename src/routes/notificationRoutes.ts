import { Router } from 'express';
import * as notificationController from '@controllers/notificationController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { markReadSchema } from '@validators/notificationValidators';

const router = Router();

// Literal routes before any param routes (there are none here, but keep the
// convention). unread-count is polled often and stays a cheap partial-index hit.
router.get('/', protect, notificationController.list);
router.get('/unread-count', protect, notificationController.unreadCount);
router.post('/read', protect, validateBody(markReadSchema), notificationController.markRead);

export default router;
