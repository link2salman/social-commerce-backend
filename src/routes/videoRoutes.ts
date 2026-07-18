import { Router } from 'express';
import * as videoController from '@controllers/videoController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { commentPostSchema } from '@validators/commentValidators';
import { createVideoSchema } from '@validators/videoValidators';

const router = Router();

// Publish a new video (the media is already uploaded to storage).
router.post('/', protect, validateBody(createVideoSchema), videoController.create);

// Comments — defined before the generic /:id/:action engagement route so
// "comments" is never read as an engagement action.
router.get('/:id/comments', protect, videoController.listComments);
router.post(
  '/:id/comments',
  protect,
  validateBody(commentPostSchema),
  videoController.postComment
);

// Engagement toggles: like | dislike | save | bookmark | favorite.
router.post('/:id/:action', protect, videoController.addEngagement);
router.delete('/:id/:action', protect, videoController.removeEngagement);

export default router;
