import { QueryTypes } from 'sequelize';
import { sequelize } from '@config/db';
import { s3PublicBaseUrl } from '@config/s3';
import { deleteObjects, listAllObjects } from '@services/storageService';
import logger from '@utils/logger';

/**
 * Find and (optionally) delete bucket objects nothing in the database references.
 *
 * ## What creates orphans
 *
 * Uploading and persisting are two steps: the client PUTs to a presigned URL, then
 * calls the API to create the row. Anything that interrupts the gap leaves the
 * object with no owner — a discarded capture after the upload started, a failed
 * `POST /videos`, a crash. Nothing has ever reclaimed them, so the bucket only
 * grows. This is also the specific blocker on starting the upload while the
 * caption is still being typed, which would orphan an object every time a user
 * changes their mind.
 *
 * ## Why the reference scan is generic instead of a list of columns
 *
 * The obvious implementation enumerates the columns holding media URLs — and it is
 * the wrong one, because it is wrong by *omission*: the day someone adds a column
 * and forgets this file, the sweep stops seeing those references and starts
 * deleting live media. There is no test that fails, and the damage is silent and
 * permanent.
 *
 * So this reads `information_schema` and scans EVERY text-ish and JSONB column in
 * the schema for the bucket's public base URL. A new column is covered the moment
 * it exists. It also catches URLs buried inside JSONB, which a column list would
 * almost certainly miss — `call_records.participants[].avatar_url` and
 * `messages.attachment` are both real cases today.
 *
 * The cost is scanning more columns than strictly necessary. At this size that is
 * a sub-second query, and it buys a sweep that cannot rot.
 *
 * ## Why a grace period
 *
 * An object uploaded seconds ago legitimately has no row yet — the client is still
 * between the PUT and the create call. Without a minimum age the sweep would race
 * every publish in flight and delete media out from under it.
 */

/** An object younger than this is assumed to be mid-publish, not abandoned. */
export const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  /** Objects in the bucket at scan time. */
  scanned: number;
  /** Distinct keys referenced by at least one row. */
  referenced: number;
  /** Unreferenced AND older than the grace period. */
  orphaned: number;
  /** Unreferenced but too young to touch yet. */
  tooYoung: number;
  orphanBytes: number;
  deleted: number;
  /** Capped sample for the log — the full list can be thousands. */
  sampleKeys: string[];
}

interface ColumnRow {
  table_name: string;
  column_name: string;
}

/**
 * Every key referenced anywhere in the database.
 *
 * Built as one UNION over the candidate columns rather than a query per column,
 * so the whole scan is a single round trip and a single consistent snapshot — a
 * row written between two separate queries could otherwise be missed by both.
 */
export const collectReferencedKeys = async (): Promise<Set<string>> => {
  const base = `${s3PublicBaseUrl()}/`;

  const columns = await sequelize.query<ColumnRow>(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.data_type IN ('text', 'character varying', 'character', 'jsonb', 'json')`,
    { type: QueryTypes.SELECT }
  );

  if (columns.length === 0) return new Set();

  // Regex-escape the base URL: it contains dots and slashes, and on a
  // path-style endpoint (MinIO locally) a port number too.
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A key runs to the first character that cannot appear in one — quote,
  // whitespace, backslash — which is what terminates it inside JSONB text.
  const pattern = `${escaped}([^"'\\s\\\\]+)`;

  const selects = columns.map(
    c =>
      `SELECT DISTINCT (regexp_matches("${c.column_name}"::text, :pattern, 'g'))[1] AS key
         FROM "${c.table_name}"
        WHERE "${c.column_name}"::text LIKE :like`
  );

  const rows = await sequelize.query<{ key: string }>(selects.join(' UNION '), {
    type: QueryTypes.SELECT,
    replacements: { pattern, like: `%${base}%` },
  });

  return new Set(rows.map(r => r.key));
};

export interface SweepOptions {
  /** Report only. The default, because the alternative is unrecoverable. */
  dryRun?: boolean;
  minAgeMs?: number;
}

export const sweepOrphans = async ({
  dryRun = true,
  minAgeMs = DEFAULT_MIN_AGE_MS,
}: SweepOptions = {}): Promise<SweepResult> => {
  const referenced = await collectReferencedKeys();
  const objects = await listAllObjects();

  const cutoff = Date.now() - minAgeMs;
  const orphans: { key: string; size: number }[] = [];
  let tooYoung = 0;

  for (const obj of objects) {
    if (referenced.has(obj.key)) continue;
    // No LastModified means we cannot prove it is old enough, so we leave it.
    if (obj.lastModified === null || obj.lastModified.getTime() > cutoff) {
      tooYoung += 1;
      continue;
    }
    orphans.push({ key: obj.key, size: obj.size });
  }

  const orphanBytes = orphans.reduce((sum, o) => sum + o.size, 0);
  let deleted = 0;
  if (!dryRun && orphans.length > 0) {
    deleted = await deleteObjects(orphans.map(o => o.key));
  }

  const result: SweepResult = {
    scanned: objects.length,
    referenced: referenced.size,
    orphaned: orphans.length,
    tooYoung,
    orphanBytes,
    deleted,
    sampleKeys: orphans.slice(0, 10).map(o => o.key),
  };

  logger.info({ ...result, dry_run: dryRun }, dryRun ? 'orphan sweep (dry run)' : 'orphan sweep');
  return result;
};

/** A row still holding the pre-transcode original it superseded. */
interface OriginalRow {
  table: 'videos' | 'post_media';
  id: string;
  source_url: string;
}

export interface ReclaimResult {
  candidates: number;
  deleted: number;
  freedBytes: number;
  sampleKeys: string[];
}

/** Originals younger than this are kept — recent enough that a re-encode is plausible. */
export const DEFAULT_ORIGINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Reclaim pre-transcode originals older than the retention window.
 *
 * A SEPARATE operation from `sweepOrphans`, and deliberately so. An orphan is an
 * accident nobody wants; an original is something the system chose to keep, and
 * deleting it destroys the only copy of what the user actually shot. Bundling the
 * two would mean a routine cleanup quietly making an irreversible product
 * decision — which is precisely the bug `source_url` was added to prevent.
 *
 * Because they are now distinguishable, reclaiming them can be a first-class
 * operation with its own flag rather than a side effect.
 *
 * `source_url` is cleared in the same pass, so the row never points at an object
 * that no longer exists. The order matters: the column is cleared only after the
 * delete reports success, so a failure mid-run leaves the reference intact and the
 * object still protected, rather than orphaning it for real.
 */
/**
 * The rows whose original is old enough to reclaim. Split out from
 * `reclaimOriginals` so the selection — the part that decides what gets deleted —
 * is testable without a live bucket.
 */
export const findReclaimableOriginals = async (
  olderThanMs: number = DEFAULT_ORIGINAL_RETENTION_MS
): Promise<OriginalRow[]> => {
  const cutoff = new Date(Date.now() - olderThanMs);

  const rows = await sequelize.query<OriginalRow>(
    `SELECT 'videos' AS table, video_id::text AS id, source_url FROM videos
      WHERE source_url IS NOT NULL AND updated_at < :cutoff
      UNION ALL
     SELECT 'post_media' AS table, post_media_id::text AS id, source_url FROM post_media
      WHERE source_url IS NOT NULL AND created_at < :cutoff`,
    { type: QueryTypes.SELECT, replacements: { cutoff } }
  );

  const base = `${s3PublicBaseUrl()}/`;
  // A source_url pointing outside our bucket (a row that predates a base-URL
  // change) is skipped rather than guessed at.
  return rows.filter(r => r.source_url.startsWith(base));
};

export const reclaimOriginals = async ({
  dryRun = true,
  olderThanMs = DEFAULT_ORIGINAL_RETENTION_MS,
}: { dryRun?: boolean; olderThanMs?: number } = {}): Promise<ReclaimResult> => {
  const base = `${s3PublicBaseUrl()}/`;
  const owned = await findReclaimableOriginals(olderThanMs);

  const sized = await listAllObjects();
  const sizeByKey = new Map(sized.map(o => [o.key, o.size]));
  const keys = owned.map(r => r.source_url.slice(base.length));
  const freedBytes = keys.reduce((sum, k) => sum + (sizeByKey.get(k) ?? 0), 0);

  let deleted = 0;
  if (!dryRun && keys.length > 0) {
    deleted = await deleteObjects(keys);
    for (const row of owned) {
      await sequelize.query(
        row.table === 'videos'
          ? 'UPDATE videos SET source_url = NULL WHERE video_id = :id'
          : 'UPDATE post_media SET source_url = NULL WHERE post_media_id = :id',
        { replacements: { id: row.id } }
      );
    }
  }

  const result: ReclaimResult = {
    candidates: owned.length,
    deleted,
    freedBytes,
    sampleKeys: keys.slice(0, 10),
  };
  logger.info(
    { ...result, dry_run: dryRun, older_than_days: Math.round(olderThanMs / 86_400_000) },
    dryRun ? 'reclaim originals (dry run)' : 'reclaim originals'
  );
  return result;
};
