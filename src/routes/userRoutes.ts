import { Router } from 'express';
import * as userController from '@controllers/userController';
import { protect } from '@middlewares/auth';

const router = Router();

// `/search` MUST precede `/:id`, or "search" is read as a user id.
router.get('/search', protect, userController.search);

router.get('/:id', protect, userController.getProfile);
router.get('/:id/videos', protect, userController.getVideos);
router.get('/:id/followers', protect, userController.getFollowers);
router.get('/:id/following', protect, userController.getFollowing);
router.get('/:id/friends', protect, userController.getFriends);

router.post('/:id/follow', protect, userController.follow);
router.delete('/:id/follow', protect, userController.unfollow);

// accept (3 segments) is distinct from send (2 segments); ordered for clarity.
router.post(
  '/:id/friend-request/accept',
  protect,
  userController.acceptFriendRequest
);
router.post('/:id/friend-request', protect, userController.sendFriendRequest);
router.delete('/:id/friend', protect, userController.removeFriend);

router.post('/:id/block', protect, userController.block);
router.delete('/:id/block', protect, userController.unblock);

export default router;
