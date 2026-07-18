import { randomUUID } from 'crypto';
import { Op } from 'sequelize';
import { sequelize } from '@config/db';
import { NotFoundError } from '@middlewares/error';
import User from '@models/user/User';
import Event, { type EventModel } from '@models/events/Event';
import EventAttendee from '@models/events/EventAttendee';
import { hydrateUserSummaries } from '@services/socialService';
import { serializeEvent, type EventJSON } from '@serializers/eventSerializer';
import type { UserSummaryJSON } from '@serializers/userSerializer';

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
      attributes: ['event_id'],
    }),
  ]);

  const summaries = await hydrateUserSummaries(viewerId, hosts);
  const hostById = new Map<string, UserSummaryJSON>(
    summaries.map(s => [s.id, s])
  );
  const attendingSet = new Set(myAttendance.map(a => a.event_id));

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
        latitude: input.latitude,
        longitude: input.longitude,
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

export const buyTicket = async (
  viewerId: string,
  eventId: string,
  _paymentToken: string
): Promise<EventJSON> => {
  const event = await requireEvent(eventId);
  await sequelize.transaction(async transaction => {
    const [row, created] = await EventAttendee.findOrCreate({
      where: { event_id: eventId, user_id: viewerId },
      defaults: { event_id: eventId, user_id: viewerId, has_ticket: true },
      transaction,
    });
    if (created) {
      await event.increment('attendee_count', { by: 1, transaction });
    } else if (!row.has_ticket) {
      await row.update({ has_ticket: true }, { transaction });
    }
  });
  await event.reload();
  const [json] = await serializeEvents(viewerId, [event]);
  return json!;
};
