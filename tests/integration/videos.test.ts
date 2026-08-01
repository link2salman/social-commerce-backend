import { api, path } from '../helpers/app';
import { registerUsers, bearer, type TestUser } from '../helpers/factories';
import { MAX_VIDEO_DURATION_MS } from '@constants/media';
import Video from '@models/feed/Video';
import User from '@models/user/User';

interface CreateVideoBody {
  video_url?: string;
  thumbnail_url?: string | null;
  caption?: string;
  duration_ms?: number;
  sound_name?: string | null;
  filter_id?: string | null;
  product_ids?: string[];
}

const createVideo = (author: TestUser, overrides: CreateVideoBody = {}) =>
  api()
    .post(path('/videos'))
    .set('Authorization', bearer(author))
    .send({
      video_url: 'https://cdn.example.test/clip.mp4',
      thumbnail_url: 'https://cdn.example.test/poster.jpg',
      caption: 'shot on the roof',
      duration_ms: 18_000,
      sound_name: null,
      product_ids: [],
      ...overrides,
    });

/** Read the persisted row — filter_id is write-only, so it is not on the wire. */
const storedFilterId = async (video_id: string): Promise<string | null> => {
  const row = await Video.findByPk(video_id);
  if (!row) throw new Error(`video ${video_id} was not persisted`);
  return row.filter_id;
};

describe('videos', () => {
  describe('POST /videos', () => {
    it('publishes a video and returns the feed-card shape', async () => {
      const [author] = await registerUsers(1);
      const res = await createVideo(author, { caption: 'hello world' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        hls_url: 'https://cdn.example.test/clip.mp4',
        thumbnail_url: 'https://cdn.example.test/poster.jpg',
        caption: 'hello world',
        duration_ms: 18_000,
        author: { id: author.id, username: author.username },
        stats: { likes: 0, dislikes: 0, comments: 0, shares: 0, saves: 0 },
        products: [],
        sound_name: null,
      });
    });

    describe('duration_ms', () => {
      // This is a short-form feed and `duration_ms` arrives FROM the client, so
      // the app's 60s recording cap is a UI courtesy, not enforcement. The bound
      // (constants/media.ts, VIDEO_MAX_DURATION_MS) is 60s plus headroom for an
      // overshooting recorder and gallery picks.
      it('publishes a clip at the app cap plus overshoot', async () => {
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { duration_ms: 60_400 });

        expect(res.status).toBe(201);
        expect(res.body.data.duration_ms).toBe(60_400);
      });

      it('accepts exactly the ceiling — the bound is inclusive', async () => {
        const [author] = await registerUsers(1);
        const res = await createVideo(author, {
          duration_ms: MAX_VIDEO_DURATION_MS,
        });

        expect(res.status).toBe(201);
      });

      it('400s a clip past the ceiling', async () => {
        const [author] = await registerUsers(1);
        const res = await createVideo(author, {
          duration_ms: MAX_VIDEO_DURATION_MS + 1,
        });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(res.body.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: 'duration_ms' }),
          ])
        );
      });

      it('400s the three-hour clip that used to publish fine, with no row left behind', async () => {
        const [author] = await registerUsers(1);
        const before = await Video.count({ where: { author_id: author.id } });

        const res = await createVideo(author, { duration_ms: 3 * 60 * 60_000 });

        expect(res.status).toBe(400);
        await expect(
          Video.count({ where: { author_id: author.id } })
        ).resolves.toBe(before);
      });
    });

    describe('filter_id', () => {
      // The camera filter is preview-only in the app (the uploaded file is
      // unfiltered), so this column records the creator's INTENT for a future
      // transcode step. Nothing reads it back yet — which is exactly why it
      // needs a test: without one, the only evidence the value survives the
      // request is a column nobody queries.
      it('persists the filter the clip was shot with', async () => {
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { filter_id: 'vivid' });

        expect(res.status).toBe(201);
        await expect(storedFilterId(res.body.data.id)).resolves.toBe('vivid');
      });

      it.each(['none', 'warm', 'mono', 'beauty'])(
        'accepts any app-defined filter id (%s) without a backend enum',
        async filter_id => {
          const [author] = await registerUsers(1);
          const res = await createVideo(author, { filter_id });

          expect(res.status).toBe(201);
          await expect(storedFilterId(res.body.data.id)).resolves.toBe(filter_id);
        }
      );

      it('accepts a filter id the backend has never heard of', async () => {
        // Deliberate: the app owns the filter list, so adding one there must
        // not require a backend deploy. A validating enum here would 400 the
        // app's next release.
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { filter_id: 'cinematic-2099' });

        expect(res.status).toBe(201);
        await expect(storedFilterId(res.body.data.id)).resolves.toBe(
          'cinematic-2099'
        );
      });

      it('stores null when the client sends no filter_id at all', async () => {
        // Non-camera publish paths omit the field; older app builds never send
        // it. Both must still publish.
        const [author] = await registerUsers(1);
        const res = await createVideo(author);

        expect(res.status).toBe(201);
        await expect(storedFilterId(res.body.data.id)).resolves.toBeNull();
      });

      it('stores null when the client sends filter_id: null explicitly', async () => {
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { filter_id: null });

        expect(res.status).toBe(201);
        await expect(storedFilterId(res.body.data.id)).resolves.toBeNull();
      });

      it('400s on a filter_id longer than the column allows', async () => {
        // The Zod bound mirrors videos.filter_id VARCHAR(32): the request is
        // rejected at the boundary rather than blowing up in Postgres.
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { filter_id: 'f'.repeat(33) });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Validation failed');
      });

      it('is NOT echoed back on the response — the app does not read it', async () => {
        // Guards the serializer decision: the app's VideoSchema has no
        // filter_id, so the wire shape stays exactly what it parses.
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { filter_id: 'warm' });

        expect(res.status).toBe(201);
        expect(res.body).not.toHaveProperty('filter_id');
      });
    });

    it.each([
      ['a non-url video_url', { video_url: 'not-a-url' }],
      ['a missing video_url', { video_url: undefined }],
      ['a zero duration', { duration_ms: 0 }],
      ['a fractional duration', { duration_ms: 1234.5 }],
    ])('400s on %s', async (_label, overrides) => {
      const [author] = await registerUsers(1);
      const res = await createVideo(author, overrides as CreateVideoBody);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
    });

    it('requires auth', async () => {
      const res = await api().post(path('/videos')).send({});
      expect(res.status).toBe(401);
    });
  });

  describe('POST /videos/:id/share', () => {
    it('records a share and returns the new count', async () => {
      const [author] = await registerUsers(1);
      const created = await createVideo(author);
      const id = created.body.data.id as string;
      expect(created.body.data.stats.shares).toBe(0);

      const first = await api()
        .post(path(`/videos/${id}/share`))
        .set('Authorization', bearer(author));
      expect(first.status).toBe(200);
      // Exact wire shape the app Zod-parses: { share_count }.
      expect(Object.keys(first.body.data)).toEqual(["share_count"]);
      expect(first.body.data.share_count).toBe(1);

      const second = await api()
        .post(path(`/videos/${id}/share`))
        .set('Authorization', bearer(author));
      expect(second.body.data.share_count).toBe(2);
    });

    it('404s for a video that does not exist', async () => {
      const [user] = await registerUsers(1);
      const res = await api()
        .post(path('/videos/00000000-0000-4000-8000-000000000000/share'))
        .set('Authorization', bearer(user));
      expect(res.status).toBe(404);
    });

    it('is NOT swallowed by the generic engagement route', async () => {
      // /:id/share is declared before /:id/:action; a like still toggles.
      const [author] = await registerUsers(1);
      const created = await createVideo(author);
      const like = await api()
        .post(path(`/videos/${created.body.data.id}/like`))
        .set('Authorization', bearer(author));
      expect(like.status).toBe(200);
      expect(like.body.success).toBe(true);
    });

    it('requires auth', async () => {
      const [author] = await registerUsers(1);
      const created = await createVideo(author);
      const res = await api().post(path(`/videos/${created.body.data.id}/share`));
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /videos/:id', () => {
    const remove = (user: TestUser, id: string) =>
      api().delete(path(`/videos/${id}`)).set('Authorization', bearer(user));

    it('lets the author delete their own video', async () => {
      const [author] = await registerUsers(1);
      const created = await createVideo(author);
      const res = await remove(author, created.body.data.id);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('soft-deletes, stamping the author as the actor', async () => {
      const [author] = await registerUsers(1);
      const created = await createVideo(author);
      await remove(author, created.body.data.id);

      // paranoid:false — the row must SURVIVE, so support can recover a mistap
      // and the comments/engagements pointing at it keep their target.
      const row = await Video.findByPk(created.body.data.id, { paranoid: false });
      expect(row).not.toBeNull();
      expect(row?.deleted_at).not.toBeNull();
      expect(row?.deleted_by).toBe('author');
    });

    it('refuses to let another user delete it', async () => {
      const [author, stranger] = await registerUsers(2);
      const created = await createVideo(author);
      const res = await remove(stranger, created.body.data.id);
      expect(res.status).toBe(403);

      const row = await Video.findByPk(created.body.data.id);
      expect(row).not.toBeNull(); // still live, not merely a refused response
    });

    it('does not give admins a back door into the author path', async () => {
      // An admin takedown must go through moderation, which stamps 'moderator'
      // and stays appealable. Accepting it here would stamp 'author' and
      // silently strip the appeal right.
      const [author, admin] = await registerUsers(2);
      await User.update({ is_admin: true }, { where: { user_id: admin.id } });
      const created = await createVideo(author);

      const res = await remove(admin, created.body.data.id);
      expect(res.status).toBe(403);
    });

    it('404s on a second delete rather than reporting success twice', async () => {
      const [author] = await registerUsers(1);
      const created = await createVideo(author);
      await remove(author, created.body.data.id);
      const again = await remove(author, created.body.data.id);
      expect(again.status).toBe(404);
    });

    it('drops the video off the author’s profile and its video count', async () => {
      const [author] = await registerUsers(1);
      const created = await createVideo(author);
      const id = created.body.data.id as string;

      const before = await api()
        .get(path(`/users/${author.id}`))
        .set('Authorization', bearer(author));
      expect(before.body.data.stats.videos).toBe(1);

      await remove(author, id);

      const listed = await api()
        .get(path(`/users/${author.id}/videos`))
        .set('Authorization', bearer(author));
      expect(listed.body.items.map((v: { id: string }) => v.id)).not.toContain(id);

      // The count is a live Video.count() under the paranoid scope, so it
      // self-corrects — no denormalized counter to drift.
      const after = await api()
        .get(path(`/users/${author.id}`))
        .set('Authorization', bearer(author));
      expect(after.body.data.stats.videos).toBe(0);
    });

    it('cannot be appealed — you deleted it yourself', async () => {
      // The reason `deleted_by` exists. Without it, deleting your own video and
      // appealing it would open a dispute over an action no moderator took, and
      // anyone could flood the queue on demand.
      const [author] = await registerUsers(1);
      const created = await createVideo(author);
      await remove(author, created.body.data.id);

      const appeal = await api()
        .post(path('/appeals'))
        .set('Authorization', bearer(author))
        .send({
          target_type: 'video',
          target_id: created.body.data.id,
          reason: 'I changed my mind and want it back',
        });
      expect(appeal.status).toBe(400);
    });

    it('requires auth', async () => {
      const [author] = await registerUsers(1);
      const created = await createVideo(author);
      const res = await api().delete(path(`/videos/${created.body.data.id}`));
      expect(res.status).toBe(401);
    });

    it('is not swallowed by the engagement route', async () => {
      // DELETE /:id (one segment) and DELETE /:id/:action (two) must stay
      // distinct — un-liking should not delete the video.
      const [author] = await registerUsers(1);
      const created = await createVideo(author);
      const id = created.body.data.id as string;

      await api().post(path(`/videos/${id}/like`)).set('Authorization', bearer(author));
      const unlike = await api()
        .delete(path(`/videos/${id}/like`))
        .set('Authorization', bearer(author));
      expect(unlike.status).toBe(200);

      const row = await Video.findByPk(id);
      expect(row).not.toBeNull();
    });
  });
});
