import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send, sendOk } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import * as events from '@services/eventService';
import type { EventInputBody } from '@validators/eventValidators';

const eventId = (req: Request): string => req.params.id as string;

// GET /v1/events → { items: Event[] } (soonest first)
export const list = asyncHandler(async (req: Request, res: Response) => {
  send(res, await events.listEvents(requireUserId(req)));
});

// GET /v1/events/:id → Event
export const get = asyncHandler(async (req: Request, res: Response) => {
  send(res, await events.getEvent(requireUserId(req), eventId(req)));
});

// POST /v1/events { EventInput } → Event (201)
export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as EventInputBody;
  send(res, await events.createEvent(requireUserId(req), input), 201);
});

// POST/DELETE /v1/events/:id/rsvp → { ok: true }
export const rsvpOn = asyncHandler(async (req: Request, res: Response) => {
  await events.setRsvp(requireUserId(req), eventId(req), true);
  sendOk(res);
});
export const rsvpOff = asyncHandler(async (req: Request, res: Response) => {
  await events.setRsvp(requireUserId(req), eventId(req), false);
  sendOk(res);
});

// POST /v1/events/:id/tickets/intent → { event, provider, clientSecret, … } (201)
// Free events attend instantly; paid events open a Stripe PaymentIntent.
export const buyTicketIntent = asyncHandler(
  async (req: Request, res: Response) => {
    const intent = await events.createTicketIntent(requireUserId(req), eventId(req));
    send(res, intent, 201);
  }
);

// POST /v1/events/:id/tickets/confirm → Event — finalize after payment succeeds.
export const confirmTicket = asyncHandler(async (req: Request, res: Response) => {
  send(res, await events.confirmTicket(requireUserId(req), eventId(req)));
});
