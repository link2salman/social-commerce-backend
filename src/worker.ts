// Media worker: drains the `media_jobs` queue (today: clip transcodes).
//
// A SEPARATE PROCESS, not a timer inside the API. ffmpeg saturates a core for the
// length of a clip, and Node is single-threaded — run this in-process and every
// request served during a transcode waits behind it. On a small VPS that is the
// difference between "publishing a video is slower" and "the whole API stalls for
// twenty seconds". PM2 runs it alongside the API from the same build; see
// ecosystem.config.js.
//
// Aliases resolve via tsconfig-paths in dev and module-alias in prod, exactly as
// server.ts documents — hence the matching npm scripts.
import { sequelize, testConnection } from '@config/db';
import { isStorageConfigured } from '@config/s3';
import '@models/index';
import { claimNext, markDone, markFailed, requeueOrphaned } from '@services/mediaJobService';
import { transcodeVideo } from '@services/transcodeService';
import { NotFoundError, BadRequestError } from '@middlewares/error';
import { numberEnv } from '@utils/env';
import logger from '@utils/logger';

// Idle poll interval. Generous on purpose: a publish is not latency-sensitive at
// this stage (the clip is already watchable — see videoService), and a tight loop
// would be a pointless query every second forever. After a job runs, the loop
// immediately looks for another rather than sleeping, so a burst drains at full
// speed and it is only true idleness that waits.
const POLL_MS = numberEnv('MEDIA_WORKER_POLL_MS', 5_000);

let shuttingDown = false;
/** Resolves the current sleep early so SIGTERM doesn't wait out the interval. */
let wakeUp: (() => void) | null = null;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    const timer = setTimeout(() => {
      wakeUp = null;
      resolve();
    }, ms);
    wakeUp = () => {
      clearTimeout(timer);
      wakeUp = null;
      resolve();
    };
  });

/**
 * Errors that retrying cannot fix, so they skip the retry budget:
 *   NotFound   — the video was deleted between publish and transcode.
 *   BadRequest — `keyFromPublicUrl` rejected the URL, i.e. the media is not in
 *                our bucket at all (the seeded sample clips point at Apple's and
 *                Google's demo CDNs). Nothing to transcode, ever.
 */
const isPermanent = (error: unknown): boolean =>
  error instanceof NotFoundError || error instanceof BadRequestError;

/** @returns whether a job was processed (so the loop knows not to sleep). */
const runOnce = async (): Promise<boolean> => {
  const job = await claimNext('video_transcode');
  if (!job) return false;

  logger.info(
    { job_id: job.job_id, subject_id: job.subject_id, attempt: job.attempts },
    'transcoding clip'
  );
  try {
    await transcodeVideo(job.subject_id);
    await markDone(job.job_id);
  } catch (error) {
    await markFailed(job, error, { permanent: isPermanent(error) });
  }
  return true;
};

const main = async (): Promise<void> => {
  await testConnection();

  // Every job reads and writes objects, so without storage there is no work this
  // process can ever do. Exit loudly rather than spinning on a queue it cannot
  // drain — same "env-gated, not silently degraded" contract as the API's 503.
  if (!isStorageConfigured()) {
    logger.fatal('S3_BUCKET is not set — the media worker has nothing it can do.');
    await sequelize.close();
    process.exit(1);
  }

  await requeueOrphaned('video_transcode');
  logger.info({ poll_ms: POLL_MS }, 'media worker started');

  while (!shuttingDown) {
    let didWork = false;
    try {
      didWork = await runOnce();
    } catch (error) {
      // claimNext itself failed — the DB is down or restarting. Never let that
      // kill the loop; back off one interval and try again.
      logger.error({ err: error }, 'media worker loop error');
    }
    if (!didWork && !shuttingDown) await sleep(POLL_MS);
  }

  await sequelize.close();
  logger.info('media worker stopped');
};

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn({ signal }, 'media worker shutting down');
  // Wake an idle sleep so we exit now. A job already in flight is allowed to
  // finish: it holds a claimed row, and PM2's kill_timeout covers the wait.
  wakeUp?.();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

void main().catch(error => {
  logger.fatal({ err: error }, 'media worker failed to start');
  process.exit(1);
});
