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
