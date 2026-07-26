import { api, path } from '../helpers/app';
import { registerUsers, bearer, daysFromNow, type TestUser } from '../helpers/factories';
import Event from '@models/events/Event';
import EventAttendee from '@models/events/EventAttendee';

interface EventInput {
  title?: string;
  description?: string;
  starts_at?: string;
  ends_at?: string | null;
  location_name?: string;
  price_cents?: number;
  latitude?: number | null;
  longitude?: number | null;
}

const createEvent = (host: TestUser, overrides: EventInput = {}) =>
  api()
    .post(path('/events'))
    .set('Authorization', bearer(host))
    .send({
      title: 'Rooftop Launch',
      description: 'Drinks and demos.',
      starts_at: daysFromNow(7),
      ends_at: null,
      location_name: 'The Roof, 1 Main St',
      price_cents: 0,
      latitude: 51.5074,
      longitude: -0.1278,
      ...overrides,
    });

describe('events', () => {
  describe('POST /events', () => {
    it('creates an event, auto-attends the host, and returns price_cents in MINOR units', async () => {
      const [host] = await registerUsers(1);
      const res = await createEvent(host, { price_cents: 3500 });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        id: expect.any(String),
        title: 'Rooftop Launch',
        description: 'Drinks and demos.',
        cover_url: expect.stringContaining('picsum.photos'),
        starts_at: expect.any(String),
        ends_at: null,
        location_name: 'The Roof, 1 Main St',
        host: {
          id: host.id,
          username: host.username,
          display_name: host.username,
          avatar_url: null,
          viewer: { is_self: true, is_following: false, friend_status: 'none' },
        },
        attendee_count: 1,
        is_attending: true, // the host is an attendee from the start
        price_cents: 3500, // events use integer cents on the wire, unlike commerce
        currency: 'USD',
        latitude: 51.5074,
        longitude: -0.1278,
      });
    });

    it('stores null coordinates when none are supplied and geocoding is unconfigured', async () => {
      const [host] = await registerUsers(1);
      const res = await createEvent(host, { latitude: null, longitude: null });

      // GOOGLE_MAPS_API_KEY is unset in the test env, so geocodeAddress is a
      // no-op and the event falls back to a free-text maps link in the app.
      expect(res.status).toBe(201);
      expect(res.body.data.latitude).toBeNull();
      expect(res.body.data.longitude).toBeNull();
    });

    it.each([
      ['a non-datetime starts_at', { starts_at: 'next tuesday' }],
      ['an empty title', { title: '' }],
      ['a negative price', { price_cents: -100 }],
      ['a fractional price', { price_cents: 12.5 }],
    ])('400s on %s', async (_label, overrides) => {
      const [host] = await registerUsers(1);
      const res = await createEvent(host, overrides as EventInput);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
    });

    it('requires auth', async () => {
      const res = await api().post(path('/events')).send({});
      expect(res.status).toBe(401);
    });
  });

  describe('GET /events and GET /events/:id', () => {
    it('lists events soonest-first with viewer-relative attendance', async () => {
      const [host, viewer] = await registerUsers(2);
      const later = await createEvent(host, { title: 'Later', starts_at: daysFromNow(30) });
      const sooner = await createEvent(host, { title: 'Sooner', starts_at: daysFromNow(2) });

      const res = await api().get(path('/events')).set('Authorization', bearer(viewer));

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(["items", "message", "success"]);

      // The endpoint returns EVERY event (other tests in this file created some
      // too), so assert the contract itself — the whole list is ordered by
      // starts_at ascending…
      const startTimes = res.body.items.map((e: { starts_at: string }) =>
        Date.parse(e.starts_at)
      );
      expect([...startTimes].sort((a, b) => a - b)).toEqual(startTimes);

      // …and our two land in the right relative order within it.
      const mine = res.body.items
        .filter((e: { id: string }) => [sooner.body.data.id, later.body.data.id].includes(e.id))
        .map((e: { id: string }) => e.id);
      expect(mine).toEqual([sooner.body.data.id, later.body.data.id]);

      // The viewer hosts none of them and attends none of them.
      const ours = res.body.items.filter((e: { id: string }) =>
        [sooner.body.data.id, later.body.data.id].includes(e.id)
      );
      for (const item of ours) {
        expect(item.is_attending).toBe(false);
        expect(item.host.viewer.is_self).toBe(false);
      }

      // The host's own view shows them attending their own events.
      const hostView = await api().get(path('/events')).set('Authorization', bearer(host));
      const hostOurs = hostView.body.items.filter((e: { id: string }) =>
        [sooner.body.data.id, later.body.data.id].includes(e.id)
      );
      expect(hostOurs).toHaveLength(2);
      expect(
        hostOurs.every((e: { is_attending: boolean; host: { viewer: { is_self: boolean } } }) =>
          e.is_attending && e.host.viewer.is_self
        )
      ).toBe(true);
    });

    it('returns a single event by id', async () => {
      const [host, viewer] = await registerUsers(2);
      const created = await createEvent(host, { title: 'Solo' });

      const res = await api()
        .get(path(`/events/${created.body.data.id}`))
        .set('Authorization', bearer(viewer));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(created.body.data.id);
      expect(res.body.data.title).toBe('Solo');
      expect(res.body.data.is_attending).toBe(false);
      expect(res.body.data.attendee_count).toBe(1);
    });

    it('404s for an unknown event', async () => {
      const [viewer] = await registerUsers(1);
      const res = await api()
        .get(path('/events/00000000-0000-4000-8000-000000000000'))
        .set('Authorization', bearer(viewer));

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Event not found');
    });

    it('requires auth', async () => {
      const res = await api().get(path('/events'));
      expect(res.status).toBe(401);
    });
  });

  describe('RSVP toggle', () => {
    it('adds and removes attendance, keeping the denormalized count correct', async () => {
      const [host, guest] = await registerUsers(2);
      const eventId = (await createEvent(host)).body.data.id;

      const on = await api()
        .post(path(`/events/${eventId}/rsvp`))
        .set('Authorization', bearer(guest));
      expect(on.status).toBe(200);
      expect(on.body.success).toBe(true);

      const attending = await api()
        .get(path(`/events/${eventId}`))
        .set('Authorization', bearer(guest));
      expect(attending.body.data.is_attending).toBe(true);
      expect(attending.body.data.attendee_count).toBe(2); // host + guest

      const off = await api()
        .delete(path(`/events/${eventId}/rsvp`))
        .set('Authorization', bearer(guest));
      expect(off.status).toBe(200);

      const gone = await api()
        .get(path(`/events/${eventId}`))
        .set('Authorization', bearer(guest));
      expect(gone.body.data.is_attending).toBe(false);
      expect(gone.body.data.attendee_count).toBe(1);
      expect(
        await EventAttendee.count({ where: { event_id: eventId, user_id: guest.id } })
      ).toBe(0);
    });

    it('is idempotent in both directions', async () => {
      const [host, guest] = await registerUsers(2);
      const eventId = (await createEvent(host)).body.data.id;

      await api().post(path(`/events/${eventId}/rsvp`)).set('Authorization', bearer(guest));
      await api().post(path(`/events/${eventId}/rsvp`)).set('Authorization', bearer(guest));

      const doubled = await api()
        .get(path(`/events/${eventId}`))
        .set('Authorization', bearer(guest));
      // The second RSVP must NOT double-count the attendee.
      expect(doubled.body.data.attendee_count).toBe(2);

      await api().delete(path(`/events/${eventId}/rsvp`)).set('Authorization', bearer(guest));
      await api().delete(path(`/events/${eventId}/rsvp`)).set('Authorization', bearer(guest));

      const removed = await api()
        .get(path(`/events/${eventId}`))
        .set('Authorization', bearer(guest));
      expect(removed.body.data.attendee_count).toBe(1);
      expect((await Event.findByPk(eventId))!.attendee_count).toBe(1);
    });

    it('404s an RSVP to an unknown event', async () => {
      const [guest] = await registerUsers(1);
      const res = await api()
        .post(path('/events/00000000-0000-4000-8000-000000000000/rsvp'))
        .set('Authorization', bearer(guest));

      expect(res.status).toBe(404);
    });
  });

  describe('ticket path', () => {
    it('settles a FREE event instantly with provider "none"', async () => {
      const [host, guest] = await registerUsers(2);
      const eventId = (await createEvent(host, { price_cents: 0 })).body.data.id;

      const intent = await api()
        .post(path(`/events/${eventId}/tickets/intent`))
        .set('Authorization', bearer(guest));

      expect(intent.status).toBe(201);
      expect(intent.body.data).toMatchObject({
        provider: 'none', // the client skips its PaymentSheet
        client_secret: null,
        publishable_key: null,
        amount: 0,
        currency: 'USD',
      });
      expect(intent.body.data.event.is_attending).toBe(true);
      expect(intent.body.data.event.attendee_count).toBe(2);

      // A free RSVP row carries no payment intent and still counts as attending.
      const row = await EventAttendee.findOne({
        where: { event_id: eventId, user_id: guest.id },
      });
      expect(row!.payment_intent_id).toBeNull();
      expect(row!.has_ticket).toBe(false);
    });

    it('is idempotent for a free event', async () => {
      const [host, guest] = await registerUsers(2);
      const eventId = (await createEvent(host, { price_cents: 0 })).body.data.id;
      const url = path(`/events/${eventId}/tickets/intent`);

      await api().post(url).set('Authorization', bearer(guest));
      const second = await api().post(url).set('Authorization', bearer(guest));

      expect(second.status).toBe(201);
      expect(second.body.data.event.attendee_count).toBe(2);
    });

    it('GATES a PAID event behind Stripe — 503 while STRIPE_SECRET_KEY is unset', async () => {
      const [host, guest] = await registerUsers(2);
      const eventId = (await createEvent(host, { price_cents: 3500 })).body.data.id;

      const res = await api()
        .post(path(`/events/${eventId}/tickets/intent`))
        .set('Authorization', bearer(guest));

      // The integration is wired but env-gated: a clear 503 the operator can act
      // on, never a 500 and never a silent free ticket.
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/payments are not configured/i);
      expect(res.body.message).toMatch(/STRIPE_SECRET_KEY/);

      // Crucially: no attendee row was created, so the caller did NOT get in free.
      expect(
        await EventAttendee.count({ where: { event_id: eventId, user_id: guest.id } })
      ).toBe(0);
      const event = await Event.findByPk(eventId);
      expect(event!.attendee_count).toBe(1); // host only
    });

    it('404s confirming a ticket that was never started', async () => {
      const [host, guest] = await registerUsers(2);
      const eventId = (await createEvent(host, { price_cents: 3500 })).body.data.id;

      const res = await api()
        .post(path(`/events/${eventId}/tickets/confirm`))
        .set('Authorization', bearer(guest));

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Ticket not found');
    });

    it('400s confirming when the attendee has no pending payment', async () => {
      const [host, guest] = await registerUsers(2);
      const eventId = (await createEvent(host, { price_cents: 0 })).body.data.id;
      // A free RSVP leaves an attendee row with no payment_intent_id.
      await api().post(path(`/events/${eventId}/rsvp`)).set('Authorization', bearer(guest));

      const res = await api()
        .post(path(`/events/${eventId}/tickets/confirm`))
        .set('Authorization', bearer(guest));

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('No pending payment for this ticket.');
    });

    it('returns the event unchanged when the ticket is already settled', async () => {
      const [host, guest] = await registerUsers(2);
      const eventId = (await createEvent(host, { price_cents: 3500 })).body.data.id;
      // Simulate a settled purchase (the state the webhook / confirm leaves behind).
      await EventAttendee.create({
        event_id: eventId,
        user_id: guest.id,
        has_ticket: true,
        payment_intent_id: 'pi_test_settled',
      });
      await Event.increment('attendee_count', { by: 1, where: { event_id: eventId } });

      const res = await api()
        .post(path(`/events/${eventId}/tickets/confirm`))
        .set('Authorization', bearer(guest));

      // Idempotent: never re-charges, never re-increments.
      expect(res.status).toBe(200);
      expect(res.body.data.is_attending).toBe(true);
      expect(res.body.data.attendee_count).toBe(2);
    });

    it('does not count a PENDING paid ticket as attending', async () => {
      const [host, guest] = await registerUsers(2);
      const eventId = (await createEvent(host, { price_cents: 3500 })).body.data.id;
      // The state createTicketIntent leaves behind before payment settles.
      await EventAttendee.create({
        event_id: eventId,
        user_id: guest.id,
        has_ticket: false,
        payment_intent_id: 'pi_test_pending',
      });

      const res = await api()
        .get(path(`/events/${eventId}`))
        .set('Authorization', bearer(guest));

      expect(res.status).toBe(200);
      expect(res.body.data.is_attending).toBe(false);
      expect(res.body.data.attendee_count).toBe(1);
    });
  });
});
