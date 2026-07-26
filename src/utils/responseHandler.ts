import type { Response } from 'express';

/**
 * The single place a successful response body is shaped.
 *
 * Every response carries `success` and a human `message`; the payload sits
 * either under `data` (one thing) or flat under `items` (a collection). This
 * mirrors the reference backend (`io-backend/src/utils/responseHandler.ts`) so
 * both products speak the same wire protocol.
 *
 * This REPLACES the previous `utils/respond.ts`, which sent raw unwrapped
 * bodies. That divergence was deliberate at the time — the app's Zod boundary
 * parsed the raw body — but it meant every response shape was its own contract
 * with nowhere to put `success`, a message, or pagination metadata. The app now
 * unwraps the envelope in exactly one place (`core/api/client.ts`
 * → `parseResponse`), so feature schemas stay as small as they were.
 *
 * Field names in `data`/`items` are snake_case — see `serializers/`.
 */

/** One thing (or nothing): `{ success, message, data }`. */
export const sendSuccess = <T>(
  res: Response,
  message: string,
  data?: T,
  statusCode = 200
): Response =>
  res.status(statusCode).json({
    success: true,
    message,
    ...(data !== undefined && { data }),
  });

/**
 * A collection with no paging metadata: `{ success, message, items, ...extra }`.
 * Flat rather than nested under `data`, matching the reference.
 */
export const sendList = <T>(
  res: Response,
  message: string,
  items: T[],
  extra?: Record<string, unknown>,
  statusCode = 200
): Response =>
  res.status(statusCode).json({
    success: true,
    message,
    items,
    ...(extra ?? {}),
  });

/**
 * An offset-paginated collection: adds `pagination` with a derived
 * `total_pages`. Use for lists with a knowable total (admin tables, orders).
 */
export const sendPaginated = <T>(
  res: Response,
  message: string,
  items: T[],
  pagination: { total: number; page: number; limit: number },
  extra?: Record<string, unknown>,
  statusCode = 200
): Response =>
  res.status(statusCode).json({
    success: true,
    message,
    items,
    pagination: {
      ...pagination,
      total_pages: Math.max(1, Math.ceil(pagination.total / pagination.limit)),
    },
    ...(extra ?? {}),
  });

/**
 * A keyset-paginated collection: `{ success, message, items, next_cursor }`.
 *
 * The sibling of `sendPaginated` for the infinite feeds. They page by
 * (created_at, id) or by rank — stable under concurrent inserts, unlike an
 * offset — so they cannot report a `total` or a page number and must not be
 * forced into the offset shape. `next_cursor` is opaque to the client and null
 * on the last page (which is what TanStack Query's `getNextPageParam` reads).
 */
export const sendCursor = <T>(
  res: Response,
  message: string,
  items: T[],
  nextCursor: string | null,
  extra?: Record<string, unknown>,
  statusCode = 200
): Response =>
  res.status(statusCode).json({
    success: true,
    message,
    items,
    next_cursor: nextCursor,
    ...(extra ?? {}),
  });
