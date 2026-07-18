import { z } from 'zod';

// POST /events — mirrors EventInputSchema (host/id/coverUrl are server-assigned).
export const eventInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable(),
  locationName: z.string().min(1),
  priceCents: z.number().int().nonnegative().default(0),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

// POST /events/:id/tickets
export const ticketSchema = z.object({
  paymentToken: z.string().min(1),
});

export type EventInputBody = z.infer<typeof eventInputSchema>;
export type TicketBody = z.infer<typeof ticketSchema>;
