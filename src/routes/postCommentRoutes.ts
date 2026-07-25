import { Router } from 'express';
import * as postCommentController from '@controllers/postCommentController';
import { protect } from '@middlewares/auth';

const router = Router();

router.get('/:id/replies', protect, postCommentController.listReplies);
router.post('/:id/like', protect, postCommentController.addLike);
router.delete('/:id/like', protect, postCommentController.removeLike);

export default router;
