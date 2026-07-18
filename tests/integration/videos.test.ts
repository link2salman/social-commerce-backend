import { api, path } from '../helpers/app';
import { registerUsers, bearer, type TestUser } from '../helpers/factories';
import Video from '@models/feed/Video';

interface CreateVideoBody {
  videoUrl?: string;
  thumbnailUrl?: string | null;
  caption?: string;
  durationMs?: number;
  soundName?: string | null;
  filterId?: string | null;
  productIds?: string[];
}

const createVideo = (author: TestUser, overrides: CreateVideoBody = {}) =>
  api()
    .post(path('/videos'))
    .set('Authorization', bearer(author))
    .send({
      videoUrl: 'https://cdn.example.test/clip.mp4',
      thumbnailUrl: 'https://cdn.example.test/poster.jpg',
      caption: 'shot on the roof',
      durationMs: 18_000,
      soundName: null,
      productIds: [],
      ...overrides,
    });

/** Read the persisted row — filterId is write-only, so it is not on the wire. */
const storedFilterId = async (videoId: string): Promise<string | null> => {
  const row = await Video.findByPk(videoId);
  if (!row) throw new Error(`video ${videoId} was not persisted`);
  return row.filter_id;
};

describe('videos', () => {
  describe('POST /videos', () => {
    it('publishes a video and returns the feed-card shape', async () => {
      const [author] = await registerUsers(1);
      const res = await createVideo(author, { caption: 'hello world' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        hlsUrl: 'https://cdn.example.test/clip.mp4',
        thumbnailUrl: 'https://cdn.example.test/poster.jpg',
        caption: 'hello world',
        durationMs: 18_000,
        author: { id: author.id, username: author.username },
        stats: { likes: 0, dislikes: 0, comments: 0, shares: 0, saves: 0 },
        products: [],
        soundName: null,
      });
    });

    describe('filterId', () => {
      // The camera filter is preview-only in the app (the uploaded file is
      // unfiltered), so this column records the creator's INTENT for a future
      // transcode step. Nothing reads it back yet — which is exactly why it
      // needs a test: without one, the only evidence the value survives the
      // request is a column nobody queries.
      it('persists the filter the clip was shot with', async () => {
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { filterId: 'vivid' });

        expect(res.status).toBe(201);
        await expect(storedFilterId(res.body.id)).resolves.toBe('vivid');
      });

      it.each(['none', 'warm', 'mono', 'beauty'])(
        'accepts any app-defined filter id (%s) without a backend enum',
        async filterId => {
          const [author] = await registerUsers(1);
          const res = await createVideo(author, { filterId });

          expect(res.status).toBe(201);
          await expect(storedFilterId(res.body.id)).resolves.toBe(filterId);
        }
      );

      it('accepts a filter id the backend has never heard of', async () => {
        // Deliberate: the app owns the filter list, so adding one there must
        // not require a backend deploy. A validating enum here would 400 the
        // app's next release.
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { filterId: 'cinematic-2099' });

        expect(res.status).toBe(201);
        await expect(storedFilterId(res.body.id)).resolves.toBe(
          'cinematic-2099'
        );
      });

      it('stores null when the client sends no filterId at all', async () => {
        // Non-camera publish paths omit the field; older app builds never send
        // it. Both must still publish.
        const [author] = await registerUsers(1);
        const res = await createVideo(author);

        expect(res.status).toBe(201);
        await expect(storedFilterId(res.body.id)).resolves.toBeNull();
      });

      it('stores null when the client sends filterId: null explicitly', async () => {
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { filterId: null });

        expect(res.status).toBe(201);
        await expect(storedFilterId(res.body.id)).resolves.toBeNull();
      });

      it('400s on a filterId longer than the column allows', async () => {
        // The Zod bound mirrors videos.filter_id VARCHAR(32): the request is
        // rejected at the boundary rather than blowing up in Postgres.
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { filterId: 'f'.repeat(33) });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Validation failed');
      });

      it('is NOT echoed back on the response — the app does not read it', async () => {
        // Guards the serializer decision: the app's VideoSchema has no
        // filterId, so the wire shape stays exactly what it parses.
        const [author] = await registerUsers(1);
        const res = await createVideo(author, { filterId: 'warm' });

        expect(res.status).toBe(201);
        expect(res.body).not.toHaveProperty('filterId');
      });
    });

    it.each([
      ['a non-url videoUrl', { videoUrl: 'not-a-url' }],
      ['a missing videoUrl', { videoUrl: undefined }],
      ['a zero duration', { durationMs: 0 }],
      ['a fractional duration', { durationMs: 1234.5 }],
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
});
