import type { EventModel } from '@models/events/Event';
import type { UserSummaryJSON } from '@serializers/userSerializer';

// The client's event.schema.ts, snake_case on the wire. price_cents is MINOR
// units (events use cents on the wire, unlike commerce, which sends dollars).
// host reuses UserSummary.
export interface EventJSON {
  id: string;
  title: string;
  description: string;
  cover_url: string;
  starts_at: string;
  ends_at: string | null;
  location_name: string;
  host: UserSummaryJSON;
  attendee_count: number;
  is_attending: boolean;
  price_cents: number;
  currency: string;
  latitude: number | null;
  longitude: number | null;
}

export const serializeEvent = (
  event: EventModel,
  host: UserSummaryJSON,
  isAttending: boolean
): EventJSON => ({
  id: event.event_id,
  title: event.title,
  description: event.description,
  cover_url: event.cover_url,
  starts_at: event.starts_at.toISOString(),
  ends_at: event.ends_at ? event.ends_at.toISOString() : null,
  location_name: event.location_name,
  host,
  attendee_count: event.attendee_count,
  is_attending: isAttending,
  price_cents: event.price_cents,
  currency: event.currency,
  latitude: event.latitude,
  longitude: event.longitude,
});
