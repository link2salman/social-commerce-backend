import { Router } from 'express';
import * as commentController from '@controllers/commentController';
import { protect } from '@middlewares/auth';

const router = Router();

router.get('/:id/replies', protect, commentController.listReplies);
router.post('/:id/like', protect, commentController.addLike);
router.delete('/:id/like', protect, commentController.removeLike);

export default router;
