import type { EventModel } from '@models/events/Event';
import type { UserSummaryJSON } from '@serializers/userSerializer';

// The client's event.schema.ts. priceCents is MINOR units (events use priceCents
// on the wire, unlike commerce). host reuses UserSummary.
export interface EventJSON {
  id: string;
  title: string;
  description: string;
  coverUrl: string;
  startsAt: string;
  endsAt: string | null;
  locationName: string;
  host: UserSummaryJSON;
  attendeeCount: number;
  isAttending: boolean;
  priceCents: number;
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
  coverUrl: event.cover_url,
  startsAt: event.starts_at.toISOString(),
  endsAt: event.ends_at ? event.ends_at.toISOString() : null,
  locationName: event.location_name,
  host,
  attendeeCount: event.attendee_count,
  isAttending,
  priceCents: event.price_cents,
  currency: event.currency,
  latitude: event.latitude,
  longitude: event.longitude,
});
