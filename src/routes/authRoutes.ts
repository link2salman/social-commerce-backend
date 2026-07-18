import { Router } from 'express';
import * as authController from '@controllers/authController';
import { validateBody } from '@validators/validate';
import {
  loginSchema,
  signupSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '@validators/authValidators';
import { protect } from '@middlewares/auth';
import { authLimiter } from '@middlewares/rateLimiter';

const router = Router();

// Credential-guessing guard on the account-facing endpoints. Refresh is
// deliberately NOT rate-limited here — it's background traffic (~4/hour per
// signed-in app) and shares only the looser global API budget.
router.post('/signup', authLimiter, validateBody(signupSchema), authController.signup);
router.post('/login', authLimiter, validateBody(loginSchema), authController.login);
router.post('/refresh', validateBody(refreshSchema), authController.refresh);
router.post(
  '/forgot-password',
  authLimiter,
  validateBody(forgotPasswordSchema),
  authController.forgotPassword
);
router.post(
  '/reset-password',
  authLimiter,
  validateBody(resetPasswordSchema),
  authController.resetPassword
);
router.post('/logout', protect, authController.logout);

export default router;
