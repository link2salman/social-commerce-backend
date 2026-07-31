import { QueryTypes, fn, type Transaction } from 'sequelize';
import { sequelize } from '@config/db';
import MediaJob, { type MediaJobModel } from '@models/media/MediaJob';
import { tableNames } from '@utils/modelAlias';
import { numberEnv } from '@utils/env';
import logger from '@utils/logger';
import type { MediaJobKind } from '@constants/enums';

// ─────────────────────────────────────────────────────────────────────────────
// The queue protocol. See the migration for why this is a Postgres table.
// ─────────────────────────────────────────────────────────────────────────────

/** Attempts before a job is parked as 'failed' for a human to look at. */
export const MAX_ATTEMPTS = numberEnv('MEDIA_JOB_MAX_ATTEMPTS', 3);
/** Backoff base: attempt N waits BACKOFF_MS * 2^(N-1). */
const BACKOFF_MS = numberEnv('MEDIA_JOB_BACKOFF_MS', 30_000);

/**
 * Queue a job, or do nothing if one is already live for this subject.
 *
 * The no-op is enforced by the partial unique index (kind, subject_id) WHERE
 * status IN ('pending','running'), not by a read-then-write — checking first
 * would race with a concurrent publish. `ignoreDuplicates` turns the resulting
 * conflict into the intended no-op.
 *
 * Pass the publishing transaction so the job commits with the row it refers to:
 * enqueueing outside it can hand a worker a subject_id that does not exist yet
 * (or never will, if the publish rolls back).
 */
export const enqueue = async (
  kind: MediaJobKind,
  subjectId: string,
  transaction?: Transaction
): Promise<void> => {
  await MediaJob.bulkCreate(
    [
      {
        kind,
        subject_id: subjectId,
        // `NOW()` evaluated by Postgres, not `new Date()` from this process.
        // `claimNext` gates on `run_after <= NOW()`, so both sides of that
        // comparison have to come from the same clock: a value from the app's
        // clock makes a fresh job briefly unclaimable whenever the database is
        // even a millisecond behind (measured at exactly 1ms on the dev Docker
        // Postgres — enough to lose the race when something claims immediately).
        //
        // The cast is the price of expressing it: the column is a Date, and
        // `bulkCreate` always names every attribute in the INSERT — writing
        // nothing here inserts an explicit NULL rather than falling through to
        // the column's own DEFAULT NOW(), which is a not-null violation.
        run_after: fn('NOW') as unknown as Date,
      },
    ],
    {
      ignoreDuplicates: true,
      ...(transaction ? { transaction } : {}),
    }
  );
};

/**
 * Take the next runnable job, or null when there is nothing to do.
 *
 * `FOR UPDATE SKIP LOCKED` is the whole trick: concurrent workers each get a
 * different row instead of queueing behind the same lock, and no job is ever
 * handed out twice. The sub-select is needed because Postgres does not allow
 * FOR UPDATE with an UPDATE's own target — so we lock a candidate, then update it
 * by id in the same statement, which keeps claim-and-mark atomic. A plain
 * `UPDATE … WHERE status='pending' LIMIT 1` cannot do that safely.
 *
 * `attempts` is bumped here, at claim time, not on failure. A worker killed
 * mid-job (OOM, SIGKILL, a hung ffmpeg) never gets to run its failure handler; if
 * the count only moved on a clean failure, such a job would be retried forever.
 * Counting attempts as "times started" makes the retry budget hold under crashes.
 */
export const claimNext = async (kind: MediaJobKind): Promise<MediaJobModel | null> => {
  const rows = await sequelize.query<MediaJobModel>(
    `
    UPDATE ${tableNames.MediaJob}
       SET status = 'running',
           locked_at = NOW(),
           attempts = attempts + 1,
           updated_at = NOW()
     WHERE job_id = (
             SELECT job_id
               FROM ${tableNames.MediaJob}
              WHERE kind = :kind
                AND status = 'pending'
                AND run_after <= NOW()
              ORDER BY run_after, created_at
              FOR UPDATE SKIP LOCKED
              LIMIT 1
           )
     RETURNING *;
    `,
    { replacements: { kind }, type: QueryTypes.SELECT }
  );
  return rows[0] ?? null;
};

export const markDone = async (jobId: string): Promise<void> => {
  await MediaJob.update(
    { status: 'done', locked_at: null, last_error: null },
    { where: { job_id: jobId } }
  );
};

/**
 * Record a failed attempt: back to 'pending' with a delay while the retry budget
 * lasts, then terminal 'failed'.
 *
 * `permanent` short-circuits the budget for errors that retrying cannot fix — a
 * deleted subject, or media hosted outside our bucket (the seeded sample clips).
 * Burning three attempts and two minutes on those is pure noise in the log.
 */
export const markFailed = async (
  job: MediaJobModel,
  error: unknown,
  { permanent = false }: { permanent?: boolean } = {}
): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = permanent || job.attempts >= MAX_ATTEMPTS;

  if (exhausted) {
    await MediaJob.update(
      { status: 'failed', locked_at: null, last_error: message },
      { where: { job_id: job.job_id } }
    );
    logger.error(
      { job_id: job.job_id, kind: job.kind, subject_id: job.subject_id, attempts: job.attempts, permanent },
      `media job failed permanently: ${message}`
    );
    return;
  }

  const delay = BACKOFF_MS * Math.pow(2, job.attempts - 1);
  await MediaJob.update(
    {
      status: 'pending',
      locked_at: null,
      last_error: message,
      run_after: new Date(Date.now() + delay),
    },
    { where: { job_id: job.job_id } }
  );
  logger.warn(
    { job_id: job.job_id, subject_id: job.subject_id, attempts: job.attempts, retry_in_ms: delay },
    `media job attempt failed, will retry: ${message}`
  );
};

/**
 * Return jobs stuck in 'running' to the queue.
 *
 * Called once at worker startup. A job is only 'running' because some worker took
 * it; if that worker is gone (deploy, crash, OOM) the row would otherwise sit
 * there forever, invisible to `claimNext` and — because of the live-subject unique
 * index — also blocking any new job for the same subject. `attempts` was already
 * charged at claim time, so a repeatedly-crashing job still runs out of budget
 * instead of looping.
 *
 * Startup-only, and single-worker-safe. With several workers this needs an age
 * threshold instead (`locked_at < NOW() - interval`), or one worker's restart
 * would yank a live job out from under another.
 */
export const requeueOrphaned = async (kind: MediaJobKind): Promise<number> => {
  const [affected] = await MediaJob.update(
    { status: 'pending', locked_at: null },
    { where: { kind, status: 'running' } }
  );
  if (affected) logger.warn({ kind, count: affected }, 'requeued orphaned media jobs');
  return affected;
};
