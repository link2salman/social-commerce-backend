import { randomUUID } from 'crypto';
import { api, path } from '../helpers/app';
import { registerUsers, bearer, type TestUser } from '../helpers/factories';
import MediaJob from '@models/media/MediaJob';
import {
  MAX_ATTEMPTS,
  claimNext,
  enqueue,
  markDone,
  markFailed,
  requeueOrphaned,
} from '@services/mediaJobService';

// The transcode queue's protocol. The ffmpeg half of the pipeline is not covered
// here on purpose: it needs S3, and this suite runs with storage deliberately
// unconfigured (see .env.test — the contract suite asserts uploads 503). What is
// testable without it is everything that decides *whether the right work runs
// exactly once*, which is where a queue actually goes wrong.

const createVideo = (author: TestUser, video_url = 'https://cdn.example.test/clip.mp4') =>
  api()
    .post(path('/videos'))
    .set('Authorization', bearer(author))
    .send({
      video_url,
      caption: 'queue me',
      duration_ms: 6_000,
      product_ids: [],
    });

/**
 * A stand-in video id. `subject_id` is polymorphic with no FK (see the model), so
 * the queue tests don't need a real video — only a distinct uuid per job.
 */
const subject = () => randomUUID();

describe('media jobs', () => {
  // Unlike the other suites, these cases assert on "what claimNext returns from
  // an empty/one-job queue", so they need the queue empty per TEST, not per file:
  // a row left pending by the case above would be handed to the one below.
  beforeEach(async () => {
    await MediaJob.destroy({ where: {}, truncate: true });
  });

  describe('enqueue on publish', () => {
    it('queues a transcode for a newly published video', async () => {
      const [author] = await registerUsers(1);
      const res = await createVideo(author);
      expect(res.status).toBe(201);

      const job = await MediaJob.findOne({
        where: { kind: 'video_transcode', subject_id: res.body.data.id },
      });
      expect(job).not.toBeNull();
      expect(job?.status).toBe('pending');
      expect(job?.attempts).toBe(0);
    });

    it('does not queue a second job while one is still live for the same video', async () => {
      const [author] = await registerUsers(1);
      const res = await createVideo(author);
      const videoId = res.body.data.id as string;

      // A retried request, or any second enqueue, must collapse into the first.
      await enqueue('video_transcode', videoId);
      await enqueue('video_transcode', videoId);

      const count = await MediaJob.count({
        where: { kind: 'video_transcode', subject_id: videoId },
      });
      expect(count).toBe(1);
    });

    it('allows a fresh job once the previous one is finished', async () => {
      const id = subject();
      await enqueue('video_transcode', id);
      const first = await claimNext('video_transcode');
      await markDone(first!.job_id);

      // The unique index is partial on pending/running, so a completed job must
      // not block re-processing the same clip later.
      await enqueue('video_transcode', id);
      const count = await MediaJob.count({ where: { subject_id: id } });
      expect(count).toBe(2);
    });
  });

  describe('claimNext', () => {
    it('hands a job out once and only once', async () => {
      await enqueue('video_transcode', subject());

      const [a, b] = await Promise.all([
        claimNext('video_transcode'),
        claimNext('video_transcode'),
      ]);

      // Whichever order they land in, exactly one worker gets the row — this is
      // what FOR UPDATE SKIP LOCKED buys.
      expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it('marks the claim running and charges an attempt up front', async () => {
      await enqueue('video_transcode', subject());
      const job = await claimNext('video_transcode');

      expect(job?.status).toBe('running');
      // Charged at claim time, not on failure, so a worker killed mid-job still
      // burns budget instead of retrying forever.
      expect(job?.attempts).toBe(1);
      expect(job?.locked_at).not.toBeNull();
    });

    it('returns null when the queue is empty', async () => {
      expect(await claimNext('video_transcode')).toBeNull();
    });

    it('skips a job whose backoff has not elapsed', async () => {
      const id = subject();
      await enqueue('video_transcode', id);
      await MediaJob.update(
        { run_after: new Date(Date.now() + 60_000) },
        { where: { subject_id: id } }
      );

      expect(await claimNext('video_transcode')).toBeNull();
    });
  });

  describe('markFailed', () => {
    it('returns the job to pending with a backoff while budget remains', async () => {
      await enqueue('video_transcode', subject());
      const job = await claimNext('video_transcode');
      const before = Date.now();

      await markFailed(job!, new Error('ffmpeg exploded'));

      const reloaded = await MediaJob.findByPk(job!.job_id);
      expect(reloaded?.status).toBe('pending');
      expect(reloaded?.last_error).toContain('ffmpeg exploded');
      expect(reloaded!.run_after.getTime()).toBeGreaterThan(before);
      expect(reloaded?.locked_at).toBeNull();
    });

    it('parks the job as failed once attempts are exhausted', async () => {
      const id = subject();
      await enqueue('video_transcode', id);

      // Drive it through the whole budget, clearing the backoff each round so the
      // next claim is eligible.
      let job = await claimNext('video_transcode');
      for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        await markFailed(job!, new Error(`attempt ${i + 1}`));
        await MediaJob.update({ run_after: new Date() }, { where: { subject_id: id } });
        const next = await claimNext('video_transcode');
        if (!next) break;
        job = next;
      }

      const reloaded = await MediaJob.findOne({ where: { subject_id: id } });
      expect(reloaded?.status).toBe('failed');
      expect(await claimNext('video_transcode')).toBeNull();
    });

    it('parks a permanent failure immediately, without spending the budget', async () => {
      await enqueue('video_transcode', subject());
      const job = await claimNext('video_transcode');

      // e.g. media hosted outside our bucket, or a deleted video — retrying can
      // never change the outcome.
      await markFailed(job!, new Error('not an object in this bucket'), { permanent: true });

      const reloaded = await MediaJob.findByPk(job!.job_id);
      expect(reloaded?.status).toBe('failed');
      expect(reloaded?.attempts).toBe(1);
    });
  });

  describe('requeueOrphaned', () => {
    it('returns jobs abandoned in running back to the queue', async () => {
      await enqueue('video_transcode', subject());
      const job = await claimNext('video_transcode');
      expect(job?.status).toBe('running');

      // Simulates the worker dying mid-job: the row is left 'running', which
      // claimNext ignores AND the live-subject index counts, so without this the
      // clip is stuck forever.
      const count = await requeueOrphaned('video_transcode');

      expect(count).toBe(1);
      const reclaimed = await claimNext('video_transcode');
      expect(reclaimed?.job_id).toBe(job!.job_id);
      // Second claim, second attempt — the budget keeps shrinking across crashes.
      expect(reclaimed?.attempts).toBe(2);
    });
  });
});
