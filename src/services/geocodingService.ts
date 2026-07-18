import { optionalEnv } from '@utils/env';
import logger from '@utils/logger';

// Turns a venue string into coordinates for the app's in-app event map. Uses the
// Google Geocoding API (same GOOGLE_MAPS_API_KEY the app's map uses). Best-effort:
// with no key, or on any failure, returns null and the event stores null lat/lng
// — the app then falls back to a free-text maps link, exactly as before.

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export const isGeocodingConfigured = (): boolean =>
  optionalEnv('GOOGLE_MAPS_API_KEY') !== '';

export const geocodeAddress = async (
  address: string
): Promise<Coordinates | null> => {
  const key = optionalEnv('GOOGLE_MAPS_API_KEY');
  if (!key || !address.trim()) return null;

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('key', key);

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Geocoding HTTP error');
      return null;
    }
    const data = (await res.json()) as {
      status: string;
      results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
    };
    const loc = data.results?.[0]?.geometry?.location;
    if (data.status !== 'OK' || !loc) {
      logger.debug({ status: data.status, address }, 'Geocoding returned no result');
      return null;
    }
    return { latitude: loc.lat, longitude: loc.lng };
  } catch (err) {
    logger.warn({ err }, 'Geocoding request failed');
    return null;
  }
};
