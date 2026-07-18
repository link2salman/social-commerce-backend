import { Router } from 'express';
import * as eventController from '@controllers/eventController';
import { protect } from '@middlewares/auth';
import { validateBody } from '@validators/validate';
import { eventInputSchema, ticketSchema } from '@validators/eventValidators';

const router = Router();

router.get('/', protect, eventController.list);
router.post('/', protect, validateBody(eventInputSchema), eventController.create);
router.get('/:id', protect, eventController.get);
router.post('/:id/rsvp', protect, eventController.rsvpOn);
router.delete('/:id/rsvp', protect, eventController.rsvpOff);
router.post(
  '/:id/tickets',
  protect,
  validateBody(ticketSchema),
  eventController.buyTicket
);

export default router;
