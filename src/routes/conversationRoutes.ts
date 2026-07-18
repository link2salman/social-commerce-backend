import { Router } from 'express';
import * as c from '@controllers/conversationController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import {
  groupInputSchema,
  addMembersSchema,
  memberRoleSchema,
  messageInputSchema,
} from '@validators/chatValidators';

const router = Router();

router.get('/', protect, c.list);

// Literals before parameterized routes.
router.post('/group', protect, validateBody(groupInputSchema), c.createGroup);
router.post('/with/:id', protect, c.openWith);

router.get('/:id/messages', protect, c.getMessages);
router.post(
  '/:id/messages',
  protect,
  validateBody(messageInputSchema),
  c.postMessage
);

router.post(
  '/:id/members',
  protect,
  validateBody(addMembersSchema),
  c.addMembers
);
router.patch(
  '/:id/members/:userId',
  protect,
  validateBody(memberRoleSchema),
  c.setMemberRole
);
router.delete('/:id/members/:userId', protect, c.removeMemberOrLeave);

export default router;
