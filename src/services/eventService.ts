import { randomUUID } from 'crypto';
import { Op } from 'sequelize';
import { sequelize } from '@config/db';
import { NotFoundError, BadRequestError } from '@middlewares/error';
import User from '@models/user/User';
import Event, { type EventModel } from '@models/events/Event';
import EventAttendee from '@models/events/EventAttendee';
import { hydrateUserSummaries } from '@services/socialService';
import {
  createPaymentIntent,
  retrievePaymentIntent,
  isPaymentIntentPaid,
} from '@services/paymentService';
import { geocodeAddress } from '@services/geocodingService';
import { centsToMajor } from '@utils/money';
import { serializeEvent, type EventJSON } from '@serializers/eventSerializer';
import type { UserSummaryJSON } from '@serializers/userSerializer';

// The payment envelope the client drives its PaymentSheet with — same contract
// as the order checkout intent. provider:'none' → free event / already ticketed,
// so the client skips the sheet.
export interface TicketIntentJSON {
  event: EventJSON;
  provider: 'stripe' | 'none';
  clientSecret: string | null;
  publishableKey: string | null;
  amount: number;
  currency: string;
}

export interface EventInputData {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  locationName: string;
  priceCents: number;
  latitude: number | null;
  longitude: number | null;
}

const coverUrlFor = (eventId: string): string =>
  `https://picsum.photos/seed/${eventId}-cover/1200/675`;

const requireEvent = async (eventId: string): Promise<EventModel> => {
  const event = await Event.findByPk(eventId);
  if (!event) throw new NotFoundError('Event');
  return event;
};

// Batch-serialize: host summaries (relative to viewer) + viewer attendance.
const serializeEvents = async (
  viewerId: string,
  events: EventModel[]
): Promise<EventJSON[]> => {
  if (events.length === 0) return [];
  const hostIds = [...new Set(events.map(e => e.host_id))];
  const eventIds = events.map(e => e.event_id);

  const [hosts, myAttendance] = await Promise.all([
    User.findAll({ where: { user_id: { [Op.in]: hostIds } } }),
    EventAttendee.findAll({
      where: { user_id: viewerId, event_id: { [Op.in]: eventIds } },
      attributes: ['event_id', 'has_ticket', 'payment_intent_id'],
    }),
  ]);

  const summaries = await hydrateUserSummaries(viewerId, hosts);
  const hostById = new Map<string, UserSummaryJSON>(
    summaries.map(s => [s.id, s])
  );
  // A row counts as attending unless it's a paid ticket still awaiting payment
  // (payment_intent_id set + has_ticket false). Free RSVPs (pi null) and settled
  // tickets (has_ticket true) both count.
  const attendingSet = new Set(
    myAttendance
      .filter(a => a.payment_intent_id === null || a.has_ticket)
      .map(a => a.event_id)
  );

  return events.map(e =>
    serializeEvent(
      e,
      hostById.get(e.host_id) ?? {
        id: e.host_id,
        username: 'unknown',
        displayName: 'unknown',
        avatarUrl: null,
        viewer: { isSelf: false, isFollowing: false, friendStatus: 'none' },
      },
      attendingSet.has(e.event_id)
    )
  );
};

export const listEvents = async (
  viewerId: string
): Promise<{ items: EventJSON[] }> => {
  const events = await Event.findAll({ order: [['starts_at', 'ASC']] });
  return { items: await serializeEvents(viewerId, events) };
};

export const getEvent = async (
  viewerId: string,
  eventId: string
): Promise<EventJSON> => {
  const event = await requireEvent(eventId);
  const [json] = await serializeEvents(viewerId, [event]);
  return json!;
};

export const createEvent = async (
  viewerId: string,
  input: EventInputData
): Promise<EventJSON> => {
  const eventId = randomUUID();

  // Geocode the venue server-side when the client didn't supply coordinates, so
  // the app's in-app map has a pin. Falls back to null (free-text maps link) when
  // no GOOGLE_MAPS_API_KEY is configured or the address doesn't resolve.
  let { latitude, longitude } = input;
  if (latitude === null || longitude === null) {
    const geo = await geocodeAddress(input.locationName);
    if (geo) {
      latitude = geo.latitude;
      longitude = geo.longitude;
    }
  }

  const event = await sequelize.transaction(async transaction => {
    const created = await Event.create(
      {
        event_id: eventId,
        host_id: viewerId,
        title: input.title,
        description: input.description,
        cover_url: coverUrlFor(eventId),
        starts_at: new Date(input.startsAt),
        ends_at: input.endsAt ? new Date(input.endsAt) : null,
        location_name: input.locationName,
        price_cents: input.priceCents,
        currency: 'USD',
        latitude,
        longitude,
        attendee_count: 1,
      },
      { transaction }
    );
    await EventAttendee.create(
      { event_id: eventId, user_id: viewerId, has_ticket: false },
      { transaction }
    );
    return created;
  });
  const [json] = await serializeEvents(viewerId, [event]);
  return json!;
};

export const setRsvp = async (
  viewerId: string,
  eventId: string,
  attending: boolean
): Promise<void> => {
  const event = await requireEvent(eventId);
  await sequelize.transaction(async transaction => {
    if (attending) {
      const [, created] = await EventAttendee.findOrCreate({
        where: { event_id: eventId, user_id: viewerId },
        defaults: { event_id: eventId, user_id: viewerId, has_ticket: false },
        transaction,
      });
      if (created) await event.increment('attendee_count', { by: 1, transaction });
    } else {
      const removed = await EventAttendee.destroy({
        where: { event_id: eventId, user_id: viewerId },
        transaction,
      });
      if (removed > 0) {
        await event.decrement('attendee_count', { by: removed, transaction });
      }
    }
  });
};

const eventJson = async (
  viewerId: string,
  event: EventModel
): Promise<EventJSON> => {
  const [json] = await serializeEvents(viewerId, [event]);
  return json!;
};

// Step 1 of buying a ticket. A free event is an instant RSVP (provider:'none').
// A paid event opens a Stripe PaymentIntent and records a PENDING attendee row
// (payment_intent_id set, has_ticket false) that does NOT yet count as attending
// or bump attendee_count — confirmTicket / the webhook flips it once paid.
export const createTicketIntent = async (
  viewerId: string,
  eventId: string
): Promise<TicketIntentJSON> => {
  const event = await requireEvent(eventId);

  const noPayment = async (): Promise<TicketIntentJSON> => ({
    event: await eventJson(viewerId, event),
    provider: 'none',
    clientSecret: null,
    publishableKey: null,
    amount: centsToMajor(event.price_cents),
    currency: event.currency,
  });

  if (event.price_cents === 0) {
    await sequelize.transaction(async transaction => {
      const [, created] = await EventAttendee.findOrCreate({
        where: { event_id: eventId, user_id: viewerId },
        defaults: { event_id: eventId, user_id: viewerId, has_ticket: false },
        transaction,
      });
      if (created) await event.increment('attendee_count', { by: 1, transaction });
    });
    await event.reload();
    return noPayment();
  }

  const existing = await EventAttendee.findOne({
    where: { event_id: eventId, user_id: viewerId },
  });
  if (existing?.has_ticket) return noPayment(); // already ticketed — idempotent

  const intent = await createPaymentIntent({
    amountCents: event.price_cents,
    currency: event.currency,
    idempotencyKey: `ticket_${eventId}_${viewerId}`,
    metadata: { kind: 'event_ticket', eventId, userId: viewerId },
    description: `Ticket for event ${eventId}`,
  });

  const [row, created] = await EventAttendee.findOrCreate({
    where: { event_id: eventId, user_id: viewerId },
    defaults: {
      event_id: eventId,
      user_id: viewerId,
      has_ticket: false,
      payment_intent_id: intent.paymentIntentId,
    },
  });
  if (!created) {
    await row.update({ payment_intent_id: intent.paymentIntentId });
  }

  return {
    event: await eventJson(viewerId, event),
    provider: 'stripe',
    clientSecret: intent.clientSecret,
    publishableKey: intent.publishableKey,
    amount: centsToMajor(event.price_cents),
    currency: event.currency,
  };
};

// Step 2 — finalize after the PaymentSheet succeeds. Confirms against Stripe
// directly so it works before the webhook lands (dev). Idempotent.
export const confirmTicket = async (
  viewerId: string,
  eventId: string
): Promise<EventJSON> => {
  const event = await requireEvent(eventId);
  const row = await EventAttendee.findOne({
    where: { event_id: eventId, user_id: viewerId },
  });
  if (!row) throw new NotFoundError('Ticket');
  if (row.has_ticket) return eventJson(viewerId, event); // already settled
  if (!row.payment_intent_id) {
    throw new BadRequestError('No pending payment for this ticket.');
  }

  const intent = await retrievePaymentIntent(row.payment_intent_id);
  if (isPaymentIntentPaid(intent)) {
    await sequelize.transaction(async transaction => {
      await row.update({ has_ticket: true }, { transaction });
      await event.increment('attendee_count', { by: 1, transaction });
    });
    await event.reload();
  }
  return eventJson(viewerId, event);
};

// Webhook-driven reconciliation. Idempotent: a settled ticket is left alone; a
// failed payment drops the still-pending row so it doesn't masquerade as an RSVP.
export const applyTicketPaymentResult = async (
  paymentIntentId: string,
  paid: boolean
): Promise<void> => {
  const row = await EventAttendee.findOne({ where: { payment_intent_id: paymentIntentId } });
  if (!row) return;

  if (paid) {
    if (row.has_ticket) return;
    const event = await Event.findByPk(row.event_id);
    await sequelize.transaction(async transaction => {
      await row.update({ has_ticket: true }, { transaction });
      if (event) await event.increment('attendee_count', { by: 1, transaction });
    });
  } else if (!row.has_ticket) {
    await row.destroy();
  }
};
