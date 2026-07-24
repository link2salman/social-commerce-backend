// Opaque keyset cursors. Endpoints paginate by (created_at, id) — stable under
// concurrent inserts, unlike a raw offset — and hand the client a base64url
// token it treats as opaque and round-trips via `?cursor=`.
import { Op, type WhereOptions } from 'sequelize';

export interface KeysetCursor {
  /** ISO timestamp of the last item on the page (the sort key). */
  ts: string;
  /** Tie-breaker id of the last item (sort key is (ts DESC, id DESC)). */
  id: string;
}

export const encodeCursor = (cursor: KeysetCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export const decodeCursor = (raw: string | undefined | null): KeysetCursor | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8')
    ) as Partial<KeysetCursor>;
    if (typeof parsed.ts !== 'string' || typeof parsed.id !== 'string') {
      return null;
    }
    return { ts: parsed.ts, id: parsed.id };
  } catch {
    // A malformed cursor is treated as "start from the beginning" rather than a
    // 400 — the client only ever sends back a cursor we minted.
    return null;
  }
};

// ── Ranked cursor ────────────────────────────────────────────────────────────
// The "For You" feed is ordered by a computed per-viewer score, not a column,
// so it can't use the keyset cursor above. This cursor carries the feed's
// ANCHOR TIME (so recency decay is computed identically across every page of a
// browsing session — the ordering stays stable even as real time passes) plus
// the (score, id) of the last item, ordered (score DESC, id DESC).
export interface RankedCursor {
  /** Epoch ms the feed was anchored at — fixes recency decay across pages. */
  anchorMs: number;
  /** Score of the last item on the page (rounded, so it round-trips exactly). */
  score: number;
  /** Tie-breaker id of the last item. */
  id: string;
}

export const encodeRankedCursor = (cursor: RankedCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export const decodeRankedCursor = (
  raw: string | undefined | null
): RankedCursor | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8')
    ) as Partial<RankedCursor>;
    if (
      typeof parsed.anchorMs !== 'number' ||
      !Number.isFinite(parsed.anchorMs) ||
      typeof parsed.score !== 'number' ||
      !Number.isFinite(parsed.score) ||
      typeof parsed.id !== 'string'
    ) {
      return null;
    }
    return { anchorMs: parsed.anchorMs, score: parsed.score, id: parsed.id };
  } catch {
    // A malformed cursor restarts the feed rather than 400-ing (same policy as
    // the keyset decoder above) — the client only sends back a cursor we minted.
    return null;
  }
};

export const DEFAULT_PAGE_SIZE = 10;

/** Clamp a page-size to a sane range. */
export const clampPageSize = (raw: unknown, fallback = DEFAULT_PAGE_SIZE): number => {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, n));
};

/**
 * WHERE predicate for a page strictly "after" the cursor, given an ORDER BY
 * (tsColumn DESC, idColumn DESC). Returns {} for the first page.
 */
export const keysetWhere = (
  cursor: KeysetCursor | null,
  idColumn: string,
  tsColumn = 'created_at'
): WhereOptions => {
  if (!cursor) return {};
  const ts = new Date(cursor.ts);
  return {
    [Op.or]: [
      { [tsColumn]: { [Op.lt]: ts } },
      { [tsColumn]: ts, [idColumn]: { [Op.lt]: cursor.id } },
    ],
  };
};
