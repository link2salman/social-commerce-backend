import { api, path } from '../helpers/app';
import { bearer, registerUser, registerUsers, type TestUser } from '../helpers/factories';

// Muting: the soft cousin of blocking. The load-bearing behaviour is that a mute
// hides the muted author's videos from the muter's FEEDS while leaving the
// follow graph intact — and that it's reflected on the profile viewer flag.

const postVideo = async (author: TestUser, caption = 'clip'): Promise<string> => {
  const res = await api().post(path('/videos')).set('Authorization', bearer(author)).send({
    video_url: 'https://cdn.example.test/clip.mp4',
    thumbnail_url: 'https://cdn.example.test/poster.jpg',
    caption,
    duration_ms: 12_000,
    sound_name: null,
    product_ids: [],
  });
  return res.body.data.id as string;
};

const follow = (viewer: TestUser, target: TestUser) =>
  api().post(path(`/users/${target.id}/follow`)).set('Authorization', bearer(viewer));
const mute = (viewer: TestUser, target: TestUser) =>
  api().post(path(`/users/${target.id}/mute`)).set('Authorization', bearer(viewer));
const unmute = (viewer: TestUser, target: TestUser) =>
  api().delete(path(`/users/${target.id}/mute`)).set('Authorization', bearer(viewer));
const followingFeed = (viewer: TestUser) =>
  api().get(path('/feed/following')).set('Authorization', bearer(viewer));
const getProfile = (viewer: TestUser, target: TestUser) =>
  api().get(path(`/users/${target.id}`)).set('Authorization', bearer(viewer));

const captionsFor = (feedBody: { items: Array<{ id: string }> }): string[] =>
  feedBody.items.map(i => i.id);

describe('mutes', () => {
  describe('mutation guards', () => {
    it('rejects an unauthenticated mute (401)', async () => {
      const target = await registerUser();
      expect((await api().post(path(`/users/${target.id}/mute`))).status).toBe(401);
    });

    it('a user cannot mute themselves (404)', async () => {
      const user = await registerUser();
      expect((await mute(user, user)).status).toBe(404);
    });

    it('muting an unknown user 404s', async () => {
      const user = await registerUser();
      const res = await api()
        .post(path('/users/00000000-0000-0000-0000-000000000000/mute'))
        .set('Authorization', bearer(user));
      expect(res.status).toBe(404);
    });

    it('mute is idempotent — muting twice still succeeds', async () => {
      const [viewer, target] = await registerUsers(2);
      expect((await mute(viewer, target)).status).toBe(200);
      expect((await mute(viewer, target)).status).toBe(200);
    });
  });

  describe('profile viewer flag', () => {
    it('reflects is_muted and toggles back on unmute — without touching the follow edge', async () => {
      const [viewer, target] = await registerUsers(2);
      await follow(viewer, target);

      const before = await getProfile(viewer, target);
      expect(before.body.data.viewer.is_muted).toBe(false);
      expect(before.body.data.viewer.is_following).toBe(true);

      await mute(viewer, target);
      const muted = await getProfile(viewer, target);
      expect(muted.body.data.viewer.is_muted).toBe(true);
      // Mute is NOT an unfollow — the follow flag survives.
      expect(muted.body.data.viewer.is_following).toBe(true);

      await unmute(viewer, target);
      const after = await getProfile(viewer, target);
      expect(after.body.data.viewer.is_muted).toBe(false);
      expect(after.body.data.viewer.is_following).toBe(true);
    });
  });

  describe('feed filtering', () => {
    it('hides a muted author from the following feed, and restores them on unmute', async () => {
      const [viewer, author] = await registerUsers(2);
      await follow(viewer, author);
      const video_id = await postVideo(author, 'muted-author clip');

      // Visible before the mute.
      const before = await followingFeed(viewer);
      expect(before.status).toBe(200);
      expect(captionsFor(before.body)).toContain(video_id);

      // Gone after the mute.
      await mute(viewer, author);
      const during = await followingFeed(viewer);
      expect(captionsFor(during.body)).not.toContain(video_id);

      // Back after unmute.
      await unmute(viewer, author);
      const after = await followingFeed(viewer);
      expect(captionsFor(after.body)).toContain(video_id);
    });

    it('still shows a muted author on their own profile grid (mute only affects feeds)', async () => {
      const [viewer, author] = await registerUsers(2);
      const video_id = await postVideo(author, 'still-on-profile');
      await mute(viewer, author);

      const grid = await api()
        .get(path(`/users/${author.id}/videos`))
        .set('Authorization', bearer(viewer));
      expect(grid.status).toBe(200);
      expect(captionsFor(grid.body)).toContain(video_id);
    });
  });
});
