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

// Ticket purchase now uses the PaymentIntent flow: POST /events/:id/tickets/intent
// (no body) then POST /events/:id/tickets/confirm (no body). Payment is proven by
// the confirmed PaymentIntent, not a client-supplied token.

export type EventInputBody = z.infer<typeof eventInputSchema>;
