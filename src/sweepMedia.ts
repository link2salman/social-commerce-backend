import 'module-alias/register';
import { sequelize, testConnection } from '@config/db';
import { isStorageConfigured } from '@config/s3';
import '@models/index';
import { DEFAULT_MIN_AGE_MS, sweepOrphans } from '@services/mediaRetentionService';
import { numberEnv } from '@utils/env';
import logger from '@utils/logger';

/**
 * One-shot orphan sweep. A separate entry point rather than a loop inside the
 * media worker, on purpose: this is the only destructive operation in the system,
 * and it should be something a human or a timer *invokes*, with its scope printed,
 * not something that quietly runs alongside a transcode.
 *
 *   npm run sweep:media                 # report only (default)
 *   npm run sweep:media -- --delete     # actually delete
 *   MEDIA_SWEEP_MIN_AGE_HOURS=72 ...    # widen the grace period
 *
 * REPORT-ONLY IS THE DEFAULT and `--delete` is deliberately verbose, because the
 * failure mode is unrecoverable: S3 has no undo, and the objects are the only copy
 * of media users uploaded. Read the dry-run output before passing the flag.
 */
const main = async (): Promise<void> => {
  const dryRun = !process.argv.includes('--delete');
  const minAgeMs = numberEnv('MEDIA_SWEEP_MIN_AGE_HOURS', 0) * 3_600_000 || DEFAULT_MIN_AGE_MS;

  await testConnection();
  if (!isStorageConfigured()) {
    logger.fatal('S3_BUCKET is not set — nothing to sweep.');
    await sequelize.close();
    process.exit(1);
  }

  const result = await sweepOrphans({ dryRun, minAgeMs });

  const mb = (result.orphanBytes / 1_048_576).toFixed(2);
  if (dryRun) {
    logger.warn(
      { would_delete: result.orphaned, would_free_mb: mb },
      'DRY RUN — nothing was deleted. Re-run with --delete to apply.'
    );
  } else {
    logger.info({ deleted: result.deleted, freed_mb: mb }, 'sweep complete');
  }

  await sequelize.close();
};

void main().catch(error => {
  logger.fatal({ err: error }, 'media sweep failed');
  process.exit(1);
});
