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

const postVideo = async (author: TestUser): Promise<string> => {
  const res = await api().post(path('/videos')).set('Authorization', bearer(author)).send({
    videoUrl: 'https://cdn.example.test/clip.mp4',
    thumbnailUrl: 'https://cdn.example.test/poster.jpg',
    caption: 'appealed clip',
    durationMs: 12_000,
    soundName: null,
    productIds: [],
  });
  return res.body.id as string;
};

const createPost = async (author: TestUser, body = 'appealed post'): Promise<string> => {
  const res = await api().post(path('/posts')).set('Authorization', bearer(author)).send({ body, imageUrls: [] });
  return res.body.id as string;
};

const suspensionAppeal = (body: Record<string, unknown>) =>
  api().post(path('/appeals/suspension')).send(body);
const videoAppeal = (user: TestUser, targetId: string, reason = 'Please review, this was legit.') =>
  api().post(path('/appeals')).set('Authorization', bearer(user)).send({ targetType: 'video', targetId, reason });
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
      expect(res.body).toEqual({ ok: true });
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
      const videoId = await postVideo(author);
      await Video.destroy({ where: { video_id: videoId } }); // moderator removed it
      expect((await videoAppeal(author, videoId)).status).toBe(201);
    });

    it('a non-author cannot appeal someone else’s removed video (403)', async () => {
      const [author, stranger] = await registerUsers(2);
      const videoId = await postVideo(author);
      await Video.destroy({ where: { video_id: videoId } });
      expect((await videoAppeal(stranger, videoId)).status).toBe(403);
    });

    it('rejects an appeal of a video that was never removed (400)', async () => {
      const author = await registerUser();
      const videoId = await postVideo(author);
      expect((await videoAppeal(author, videoId)).status).toBe(400);
    });

    it('requires authentication (401)', async () => {
      const author = await registerUser();
      const videoId = await postVideo(author);
      await Video.destroy({ where: { video_id: videoId } });
      const res = await api().post(path('/appeals')).send({ targetType: 'video', targetId: videoId, reason: 'x y z' });
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
        appealId: '00000000-0000-0000-0000-000000000000', decision: 'deny',
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
      const mine = all.body.items.find((a: { targetId: string }) => a.targetId === user.id);
      expect(mine).toBeTruthy();
      expect(mine.status).toBe('pending');

      const pending = await api().get(path('/admin/appeals?status=pending&targetType=user')).set('Authorization', bearer(admin));
      expect(pending.body.items.every((a: { status: string }) => a.status === 'pending')).toBe(true);

      const detail = await api().get(path(`/admin/appeals/${mine.id}`)).set('Authorization', bearer(admin));
      expect(detail.status).toBe(200);
      expect(detail.body.target).toMatchObject({ type: 'user', id: user.id });
    });

    it('GRANTING a suspension appeal reactivates the account', async () => {
      const [admin, user] = await registerUsers(2);
      await makeAdmin(admin);
      await suspend(user);
      await suspensionAppeal({ email: user.email, password: user.password, reason: 'please review' });
      const listed = await api().get(path('/admin/appeals?targetType=user')).set('Authorization', bearer(admin));
      const appeal = listed.body.items.find((a: { targetId: string }) => a.targetId === user.id);

      // Before: suspended account's token is rejected (403).
      expect((await ping(user)).status).toBe(403);

      const res = await resolveAppeal(admin, { appealId: appeal.id, decision: 'grant', note: 'reinstated' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'granted', decision: 'grant' });

      // After: the account works again.
      expect((await ping(user)).status).toBe(200);
    });

    it('GRANTING a video appeal restores the removed video', async () => {
      const [admin, author] = await registerUsers(2);
      await makeAdmin(admin);
      const videoId = await postVideo(author);
      await Video.destroy({ where: { video_id: videoId } });
      await videoAppeal(author, videoId);
      const listed = await api().get(path('/admin/appeals?targetType=video')).set('Authorization', bearer(admin));
      const appeal = listed.body.items.find((a: { targetId: string }) => a.targetId === videoId);

      expect(await Video.findByPk(videoId)).toBeNull(); // gone (soft-deleted)
      const res = await resolveAppeal(admin, { appealId: appeal.id, decision: 'grant' });
      expect(res.body.status).toBe('granted');
      expect(await Video.findByPk(videoId)).not.toBeNull(); // restored
    });

    it('the author of a removed post can appeal it, and GRANTING restores the post', async () => {
      const [admin, author] = await registerUsers(2);
      await makeAdmin(admin);
      const postId = await createPost(author);
      await Post.destroy({ where: { post_id: postId } }); // moderator removed it

      const filed = await api()
        .post(path('/appeals'))
        .set('Authorization', bearer(author))
        .send({ targetType: 'post', targetId: postId, reason: 'This was my own work, please restore.' });
      expect(filed.status).toBe(201);

      const listed = await api().get(path('/admin/appeals?targetType=post')).set('Authorization', bearer(admin));
      const appeal = listed.body.items.find((a: { targetId: string }) => a.targetId === postId);
      const detail = await api().get(path(`/admin/appeals/${appeal.id}`)).set('Authorization', bearer(admin));
      expect(detail.body.target).toMatchObject({ type: 'post', id: postId, authorId: author.id });

      expect(await Post.findByPk(postId)).toBeNull(); // gone (soft-deleted)
      const res = await resolveAppeal(admin, { appealId: appeal.id, decision: 'grant' });
      expect(res.body.status).toBe('granted');
      expect(await Post.findByPk(postId)).not.toBeNull(); // restored
    });

    it('a non-author cannot appeal someone else’s removed post (403)', async () => {
      const [author, stranger] = await registerUsers(2);
      const postId = await createPost(author);
      await Post.destroy({ where: { post_id: postId } });
      const res = await api()
        .post(path('/appeals'))
        .set('Authorization', bearer(stranger))
        .send({ targetType: 'post', targetId: postId, reason: 'not mine but whatever' });
      expect(res.status).toBe(403);
    });

    it('DENYING leaves the action in place, and re-resolving is a 400', async () => {
      const [admin, user] = await registerUsers(2);
      await makeAdmin(admin);
      await suspend(user);
      await suspensionAppeal({ email: user.email, password: user.password, reason: 'please review' });
      const listed = await api().get(path('/admin/appeals?targetType=user')).set('Authorization', bearer(admin));
      const appeal = listed.body.items.find((a: { targetId: string }) => a.targetId === user.id);

      const denied = await resolveAppeal(admin, { appealId: appeal.id, decision: 'deny', note: 'stands' });
      expect(denied.body.status).toBe('denied');
      // Still suspended.
      expect((await ping(user)).status).toBe(403);
      // Already resolved → 400.
      expect((await resolveAppeal(admin, { appealId: appeal.id, decision: 'grant' })).status).toBe(400);
    });
  });
});
