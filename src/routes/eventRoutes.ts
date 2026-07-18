import { Router } from 'express';
import * as eventController from '@controllers/eventController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { eventInputSchema } from '@validators/eventValidators';

const router = Router();

router.get('/', protect, eventController.list);
router.post('/', protect, validateBody(eventInputSchema), eventController.create);
router.get('/:id', protect, eventController.get);
router.post('/:id/rsvp', protect, eventController.rsvpOn);
router.delete('/:id/rsvp', protect, eventController.rsvpOff);
// Paid tickets use the two-step PaymentIntent flow (free events settle in step 1).
router.post('/:id/tickets/intent', protect, eventController.buyTicketIntent);
router.post('/:id/tickets/confirm', protect, eventController.confirmTicket);

export default router;
