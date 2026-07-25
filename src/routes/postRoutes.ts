import { Router } from 'express';
import * as postController from '@controllers/postController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { commentPostSchema } from '@validators/commentValidators';
import { createPostSchema } from '@validators/postValidators';

const router = Router();

// Create an image/text post (any attached images are already uploaded to storage).
router.post('/', protect, validateBody(createPostSchema), postController.create);

// Literal collections — defined BEFORE the generic /:id route so "feed" / "saved"
// are never read as a post id.
router.get('/feed', protect, postController.feed);
router.get('/saved', protect, postController.saved);

// Comments — before the generic /:id/:action engagement route so "comments" is
// never read as an engagement action.
router.get('/:id/comments', protect, postController.listComments);
router.post(
  '/:id/comments',
  protect,
  validateBody(commentPostSchema),
  postController.postComment
);

// Share counter — a literal, before the generic /:id/:action route.
router.post('/:id/share', protect, postController.share);

// Single post detail.
router.get('/:id', protect, postController.detail);

// Engagement toggles: like | dislike | save | bookmark | favorite.
router.post('/:id/:action', protect, postController.addEngagement);
router.delete('/:id/:action', protect, postController.removeEngagement);

export default router;
