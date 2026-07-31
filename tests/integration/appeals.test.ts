import { api, path } from '../helpers/app';
import { bearer, registerUser, registerUsers, type TestUser } from '../helpers/factories';
import User from '../../src/models/user/User';
import Video from '../../src/models/feed/Video';
import Post from '../../src/models/feed/Post';

// Appeals: users contesting a moderation action. The load-bearing tests are the
// unauthenticated suspension path (a locked-out user proves identity by
// credentials), the ownership boundary on the authenticated path, the admin
// authorization boundary, and that GRANTING an appeal actually REVERSES the
// original action (reactivate user / restore video).

const makeAdmin = (u: TestUser) => User.update({ is_admin: true }, { where: { user_id: u.id } });
const suspend = (u: TestUser) => User.update({ is_active: false }, { where: { user_id: u.id } });

/**
 * Stand in for a moderator's `remove_content`, WITHOUT going through the report
 * queue (these tests are about appeals, not moderation).
 *
 * The `deleted_by` stamp is not incidental — it is what makes a removal
 * appealable. A bare `destroy()` sets only `deleted_at`, which is now also what
 * an author's own deletion looks like, and an appeal against that is correctly
 * refused. So the fixture has to mirror what `resolveTarget` really writes, or
 * it would be testing a removal that never happens in production.
 */
const removeVideoAsModerator = async (video_id: string) => {
  await Video.update({ deleted_by: 'moderator' }, { where: { video_id } });
  await Video.destroy({ where: { video_id } });
};
const removePostAsModerator = async (post_id: string) => {
  await Post.update({ deleted_by: 'moderator' }, { where: { post_id } });
  await Post.destroy({ where: { post_id } });
};

const postVideo = async (author: TestUser): Promise<string> => {
  const res = await api().post(path('/videos')).set('Authorization', bearer(author)).send({
    video_url: 'https://cdn.example.test/clip.mp4',
    thumbnail_url: 'https://cdn.example.test/poster.jpg',
    caption: 'appealed clip',
    duration_ms: 12_000,
    sound_name: null,
    product_ids: [],
  });
  return res.body.data.id as string;
};

const createPost = async (author: TestUser, body = 'appealed post'): Promise<string> => {
  const res = await api().post(path('/posts')).set('Authorization', bearer(author)).send({ body, image_urls: [] });
  return res.body.data.id as string;
};

const suspensionAppeal = (body: Record<string, unknown>) =>
  api().post(path('/appeals/suspension')).send(body);
const videoAppeal = (user: TestUser, target_id: string, reason = 'Please review, this was legit.') =>
  api().post(path('/appeals')).set('Authorization', bearer(user)).send({ target_type: 'video', target_id, reason });
const resolveAppeal = (admin: TestUser, body: Record<string, unknown>) =>
  api().post(path('/admin/appeals/resolve')).set('Authorization', bearer(admin)).send(body);
const ping = (u: TestUser) => api().get(path('/notifications')).set('Authorization', bearer(u));

describe('appeals', () => {
  describe('suspension appeal (unauthenticated)', () => {
    it('a suspended user can file an appeal with their credentials (201)', async () => {
      const user = await registerUser();
      await suspend(user);
      const res = await suspensionAppeal({
        email: user.email,
        password: user.password,
        reason: 'Suspended by mistake, please review.',
      });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('rejects wrong credentials (401)', async () => {
      const user = await registerUser();
      await suspend(user);
      const res = await suspensionAppeal({ email: user.email, password: 'wrong-password', reason: 'x y z' });
      expect(res.status).toBe(401);
    });

    it('rejects an appeal from an account that is not suspended (400)', async () => {
      const user = await registerUser();
      const res = await suspensionAppeal({ email: user.email, password: user.password, reason: 'nothing wrong' });
      expect(res.status).toBe(400);
    });

    it('rejects a malformed body (400)', async () => {
      const res = await suspensionAppeal({ email: 'not-an-email', password: '', reason: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('authenticated content appeal', () => {
    it('the author of a removed video can appeal it (201)', async () => {
      const author = await registerUser();
      const video_id = await postVideo(author);
      await removeVideoAsModerator(video_id);
      expect((await videoAppeal(author, video_id)).status).toBe(201);
    });

    it('a non-author cannot appeal someone else’s removed video (403)', async () => {
      const [author, stranger] = await registerUsers(2);
      const video_id = await postVideo(author);
      await removeVideoAsModerator(video_id);
      expect((await videoAppeal(stranger, video_id)).status).toBe(403);
    });

    it('rejects an appeal of a video that was never removed (400)', async () => {
      const author = await registerUser();
      const video_id = await postVideo(author);
      expect((await videoAppeal(author, video_id)).status).toBe(400);
    });

    it('requires authentication (401)', async () => {
      const author = await registerUser();
      const video_id = await postVideo(author);
      await removeVideoAsModerator(video_id);
      const res = await api().post(path('/appeals')).send({ target_type: 'video', target_id: video_id, reason: 'x y z' });
      expect(res.status).toBe(401);
    });
  });

  describe('admin authorization boundary', () => {
    it('a non-admin gets 403 and an anonymous request 401 on every appeal route', async () => {
      const user = await registerUser();
      const t = bearer(user);
      expect((await api().get(path('/admin/appeals')).set('Authorization', t)).status).toBe(403);
      expect((await api().get(path('/admin/appeals')) ).status).toBe(401);
      expect((await api().post(path('/admin/appeals/resolve')).set('Authorization', t).send({
        appeal_id: '00000000-0000-0000-0000-000000000000', decision: 'deny',
      })).status).toBe(403);
    });
  });

  describe('admin queue + resolution', () => {
    it('lists appeals, filters by status, and hydrates the target on detail', async () => {
      const [admin, user] = await registerUsers(2);
      await makeAdmin(admin);
      await suspend(user);
      await suspensionAppeal({ email: user.email, password: user.password, reason: 'please review' });

      const all = await api().get(path('/admin/appeals')).set('Authorization', bearer(admin));
      expect(all.status).toBe(200);
      const mine = all.body.items.find((a: { target_id: string }) => a.target_id === user.id);
      expect(mine).toBeTruthy();
      expect(mine.status).toBe('pending');

      const pending = await api().get(path('/admin/appeals?status=pending&target_type=user')).set('Authorization', bearer(admin));
      expect(pending.body.items.every((a: { status: string }) => a.status === 'pending')).toBe(true);

      const detail = await api().get(path(`/admin/appeals/${mine.id}`)).set('Authorization', bearer(admin));
      expect(detail.status).toBe(200);
      expect(detail.body.data.target).toMatchObject({ type: 'user', id: user.id });
    });

    it('GRANTING a suspension appeal reactivates the account', async () => {
      const [admin, user] = await registerUsers(2);
      await makeAdmin(admin);
      await suspend(user);
      await suspensionAppeal({ email: user.email, password: user.password, reason: 'please review' });
      const listed = await api().get(path('/admin/appeals?target_type=user')).set('Authorization', bearer(admin));
      const appeal = listed.body.items.find((a: { target_id: string }) => a.target_id === user.id);

      // Before: suspended account's token is rejected (403).
      expect((await ping(user)).status).toBe(403);

      const res = await resolveAppeal(admin, { appeal_id: appeal.id, decision: 'grant', note: 'reinstated' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'granted', decision: 'grant' });

      // After: the account works again.
      expect((await ping(user)).status).toBe(200);
    });

    it('GRANTING a video appeal restores the removed video', async () => {
      const [admin, author] = await registerUsers(2);
      await makeAdmin(admin);
      const video_id = await postVideo(author);
      await removeVideoAsModerator(video_id);
      await videoAppeal(author, video_id);
      const listed = await api().get(path('/admin/appeals?target_type=video')).set('Authorization', bearer(admin));
      const appeal = listed.body.items.find((a: { target_id: string }) => a.target_id === video_id);

      expect(await Video.findByPk(video_id)).toBeNull(); // gone (soft-deleted)
      const res = await resolveAppeal(admin, { appeal_id: appeal.id, decision: 'grant' });
      expect(res.body.data.status).toBe('granted');
      expect(await Video.findByPk(video_id)).not.toBeNull(); // restored
    });

    it('the author of a removed post can appeal it, and GRANTING restores the post', async () => {
      const [admin, author] = await registerUsers(2);
      await makeAdmin(admin);
      const post_id = await createPost(author);
      await removePostAsModerator(post_id);

      const filed = await api()
        .post(path('/appeals'))
        .set('Authorization', bearer(author))
        .send({ target_type: 'post', target_id: post_id, reason: 'This was my own work, please restore.' });
      expect(filed.status).toBe(201);

      const listed = await api().get(path('/admin/appeals?target_type=post')).set('Authorization', bearer(admin));
      const appeal = listed.body.items.find((a: { target_id: string }) => a.target_id === post_id);
      const detail = await api().get(path(`/admin/appeals/${appeal.id}`)).set('Authorization', bearer(admin));
      expect(detail.body.data.target).toMatchObject({ type: 'post', id: post_id, author_id: author.id });

      expect(await Post.findByPk(post_id)).toBeNull(); // gone (soft-deleted)
      const res = await resolveAppeal(admin, { appeal_id: appeal.id, decision: 'grant' });
      expect(res.body.data.status).toBe('granted');
      expect(await Post.findByPk(post_id)).not.toBeNull(); // restored
    });

    it('a non-author cannot appeal someone else’s removed post (403)', async () => {
      const [author, stranger] = await registerUsers(2);
      const post_id = await createPost(author);
      await removePostAsModerator(post_id);
      const res = await api()
        .post(path('/appeals'))
        .set('Authorization', bearer(stranger))
        .send({ target_type: 'post', target_id: post_id, reason: 'not mine but whatever' });
      expect(res.status).toBe(403);
    });

    it('DENYING leaves the action in place, and re-resolving is a 400', async () => {
      const [admin, user] = await registerUsers(2);
      await makeAdmin(admin);
      await suspend(user);
      await suspensionAppeal({ email: user.email, password: user.password, reason: 'please review' });
      const listed = await api().get(path('/admin/appeals?target_type=user')).set('Authorization', bearer(admin));
      const appeal = listed.body.items.find((a: { target_id: string }) => a.target_id === user.id);

      const denied = await resolveAppeal(admin, { appeal_id: appeal.id, decision: 'deny', note: 'stands' });
      expect(denied.body.data.status).toBe('denied');
      // Still suspended.
      expect((await ping(user)).status).toBe(403);
      // Already resolved → 400.
      expect((await resolveAppeal(admin, { appeal_id: appeal.id, decision: 'grant' })).status).toBe(400);
    });
  });
});
