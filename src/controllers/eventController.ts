import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendList, sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import * as events from '@services/eventService';
import type { EventInputBody } from '@validators/eventValidators';

const eventId = (req: Request): string => req.params.id as string;

// GET /v1/events → { items } (soonest first)
export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await events.listEvents(requireUserId(req));
  sendList(res, 'Events fetched', result.items);
});

// GET /v1/events/:id → { data: Event }
export const get = asyncHandler(async (req: Request, res: Response) => {
  const event = await events.getEvent(requireUserId(req), eventId(req));
  sendSuccess(res, 'Event fetched', event);
});

// POST /v1/events { EventInput } → { data: Event } (201)
export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as EventInputBody;
  const event = await events.createEvent(requireUserId(req), input);
  sendSuccess(res, 'Event created', event, 201);
});

// POST/DELETE /v1/events/:id/rsvp
export const rsvpOn = asyncHandler(async (req: Request, res: Response) => {
  await events.setRsvp(requireUserId(req), eventId(req), true);
  sendSuccess(res, 'RSVP confirmed');
});
export const rsvpOff = asyncHandler(async (req: Request, res: Response) => {
  await events.setRsvp(requireUserId(req), eventId(req), false);
  sendSuccess(res, 'RSVP withdrawn');
});

// POST /v1/events/:id/tickets/intent
//   → { data: { event, provider, client_secret, … } } (201)
// Free events attend instantly; paid events open a Stripe PaymentIntent.
export const buyTicketIntent = asyncHandler(
  async (req: Request, res: Response) => {
    const intent = await events.createTicketIntent(
      requireUserId(req),
      eventId(req)
    );
    sendSuccess(res, 'Ticket purchase started', intent, 201);
  }
);

// POST /v1/events/:id/tickets/confirm → { data: Event } — after payment succeeds.
export const confirmTicket = asyncHandler(async (req: Request, res: Response) => {
  const event = await events.confirmTicket(requireUserId(req), eventId(req));
  sendSuccess(res, 'Ticket confirmed', event);
});
