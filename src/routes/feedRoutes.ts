import { Router } from 'express';
import * as feedController from '@controllers/feedController';
import { protect } from '@middlewares/auth';

const router = Router();

router.get('/for-you', protect, feedController.getForYou);
router.get('/following', protect, feedController.getFollowing);

export default router;
