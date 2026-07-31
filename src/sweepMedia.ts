import 'module-alias/register';
import { sequelize, testConnection } from '@config/db';
import { isStorageConfigured } from '@config/s3';
import '@models/index';
import {
  DEFAULT_MIN_AGE_MS,
  DEFAULT_ORIGINAL_RETENTION_MS,
  reclaimOriginals,
  sweepOrphans,
} from '@services/mediaRetentionService';
import { numberEnv } from '@utils/env';
import logger from '@utils/logger';

/**
 * One-shot orphan sweep. A separate entry point rather than a loop inside the
 * media worker, on purpose: this is the only destructive operation in the system,
 * and it should be something a human or a timer *invokes*, with its scope printed,
 * not something that quietly runs alongside a transcode.
 *
 *   npm run sweep:media                          # report only (default)
 *   npm run sweep:media -- --delete              # remove orphans
 *   npm run sweep:media -- --include-originals   # ALSO consider superseded originals
 *   MEDIA_SWEEP_MIN_AGE_HOURS=72 ...             # widen the orphan grace period
 *   MEDIA_ORIGINAL_RETENTION_DAYS=90 ...         # keep originals longer
 *
 * The two passes are separate because the things they remove are not alike. An
 * orphan is an accident nobody wants. An original is the only copy of what the
 * user actually shot, kept on purpose — so it takes its own flag, and running the
 * routine cleanup can never quietly make that call.
 *
 * REPORT-ONLY IS THE DEFAULT and `--delete` is deliberately verbose, because the
 * failure mode is unrecoverable: S3 has no undo, and the objects are the only copy
 * of media users uploaded. Read the dry-run output before passing the flag.
 */
const main = async (): Promise<void> => {
  const dryRun = !process.argv.includes('--delete');
  const includeOriginals = process.argv.includes('--include-originals');
  const minAgeMs = numberEnv('MEDIA_SWEEP_MIN_AGE_HOURS', 0) * 3_600_000 || DEFAULT_MIN_AGE_MS;
  const originalRetentionMs =
    numberEnv('MEDIA_ORIGINAL_RETENTION_DAYS', 0) * 86_400_000 || DEFAULT_ORIGINAL_RETENTION_MS;

  await testConnection();
  if (!isStorageConfigured()) {
    logger.fatal('S3_BUCKET is not set — nothing to sweep.');
    await sequelize.close();
    process.exit(1);
  }

  const result = await sweepOrphans({ dryRun, minAgeMs });
  let wouldDelete = result.orphaned;
  let wouldFree = result.orphanBytes;

  // Opt-in, and separate from the orphan pass on purpose: an orphan is an
  // accident, an original is the only copy of what the user shot. Requiring its
  // own flag is what stops a routine cleanup making that call by accident.
  if (includeOriginals) {
    const reclaimed = await reclaimOriginals({ dryRun, olderThanMs: originalRetentionMs });
    wouldDelete += reclaimed.candidates;
    wouldFree += reclaimed.freedBytes;
  }

  const mb = (wouldFree / 1_048_576).toFixed(2);
  if (dryRun) {
    logger.warn(
      { would_delete: wouldDelete, would_free_mb: mb, included_originals: includeOriginals },
      'DRY RUN — nothing was deleted. Re-run with --delete to apply.'
    );
  } else {
    logger.info(
      { deleted: result.deleted, freed_mb: mb, included_originals: includeOriginals },
      'sweep complete'
    );
  }

  await sequelize.close();
};

void main().catch(error => {
  logger.fatal({ err: error }, 'media sweep failed');
  process.exit(1);
});
