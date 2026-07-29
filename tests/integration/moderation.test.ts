import { api, path } from '../helpers/app';
import { bearer, registerUser, registerUsers, type TestUser } from '../helpers/factories';
import User from '../../src/models/user/User';
import Video from '../../src/models/feed/Video';
import Post from '../../src/models/feed/Post';
import PostComment from '../../src/models/feed/PostComment';

// The /admin surface: report queue + resolution. The load-bearing tests are the
// authorization boundary (a non-admin must never reach any of it) and that a
// resolution ACTUALLY affects its target, not just flips a status column.

const makeAdmin = (u: TestUser) => User.update({ is_admin: true }, { where: { user_id: u.id } });

const postVideo = async (author: TestUser): Promise<string> => {
  const res = await api().post(path('/videos')).set('Authorization', bearer(author)).send({
    video_url: 'https://cdn.example.test/clip.mp4',
    thumbnail_url: 'https://cdn.example.test/poster.jpg',
    caption: 'reported clip',
    duration_ms: 12_000,
    sound_name: null,
    product_ids: [],
  });
  return res.body.data.id as string;
};

const createPost = async (author: TestUser, body = 'reported post'): Promise<string> => {
  const res = await api().post(path('/posts')).set('Authorization', bearer(author)).send({ body, image_urls: [] });
  return res.body.data.id as string;
};

const postCommentOn = async (author: TestUser, post_id: string, body = 'reported comment'): Promise<string> => {
  const res = await api().post(path(`/posts/${post_id}/comments`)).set('Authorization', bearer(author)).send({ body });
  return res.body.data.id as string;
};

const report = (reporter: TestUser, target_type: string, target_id: string, reason = 'Spam or scam') =>
  api().post(path('/reports')).set('Authorization', bearer(reporter)).send({ target_type, target_id, reason });

const resolve = (admin: TestUser, body: Record<string, unknown>) =>
  api().post(path('/admin/reports/resolve')).set('Authorization', bearer(admin)).send(body);

describe('moderation (/admin)', () => {
  describe('authorization boundary', () => {
    it('a signed-in non-admin gets 403 on every admin route', async () => {
      const user = await registerUser();
      const t = bearer(user);
      expect((await api().get(path('/admin/reports')).set('Authorization', t)).status).toBe(403);
      expect((await api().get(path('/admin/reports/00000000-0000-0000-0000-000000000000')).set('Authorization', t)).status).toBe(403);
      expect((await api().post(path('/admin/reports/resolve')).set('Authorization', t).send({
        target_type: 'user', target_id: user.id, action: 'dismiss',
      })).status).toBe(403);
    });

    it('an unauthenticated request gets 401', async () => {
      expect((await api().get(path('/admin/reports'))).status).toBe(401);
      expect((await api().post(path('/admin/reports/resolve')).send({})).status).toBe(401);
    });

    it('exposes is_admin:true on a moderator’s OWN profile (the app gates the console on it)', async () => {
      const admin = await registerUser();
      await makeAdmin(admin);
      const self = await api().get(path(`/users/${admin.id}`)).set('Authorization', bearer(admin));
      expect(self.body.data.is_admin).toBe(true);
    });
  });

  describe('queue', () => {
    it('lists reports and filters by status', async () => {
      const [admin, reporter, target] = await registerUsers(3);
      await makeAdmin(admin);
      await report(reporter, 'user', target.id);

      const all = await api().get(path('/admin/reports')).set('Authorization', bearer(admin));
      expect(all.status).toBe(200);
      expect(all.body.items.length).toBeGreaterThanOrEqual(1);

      const pending = await api().get(path('/admin/reports?status=pending')).set('Authorization', bearer(admin));
      expect(pending.body.items.every((r: { status: string }) => r.status === 'pending')).toBe(true);

      const actioned = await api().get(path('/admin/reports?status=actioned')).set('Authorization', bearer(admin));
      expect(actioned.body.items.every((r: { status: string }) => r.status === 'actioned')).toBe(true);
    });

    it('hydrates the target on the detail view, and a gone target resolves to null (no 500)', async () => {
      const [admin, reporter, target] = await registerUsers(3);
      await makeAdmin(admin);
      await report(reporter, 'user', target.id);
      const listed = await api().get(path('/admin/reports?status=pending')).set('Authorization', bearer(admin));
      const reportId = listed.body.items.find((r: { target_id: string }) => r.target_id === target.id).id;

      const detail = await api().get(path(`/admin/reports/${reportId}`)).set('Authorization', bearer(admin));
      expect(detail.status).toBe(200);
      expect(detail.body.data.target).toMatchObject({ type: 'user', id: target.id });

      // A report against a comment id that doesn't exist → target null, still 200.
      await report(reporter, 'comment', '11111111-1111-1111-1111-111111111111');
      const ghost = await api().get(path('/admin/reports?target_type=comment')).set('Authorization', bearer(admin));
      const ghostDetail = await api().get(path(`/admin/reports/${ghost.body.items[0].id}`)).set('Authorization', bearer(admin));
      expect(ghostDetail.status).toBe(200);
      expect(ghostDetail.body.data.target).toBeNull();
    });
  });

  describe('resolution actually affects the target', () => {
    it('remove_content soft-deletes the video AND closes every pending report against it', async () => {
      const [admin, author, r1, r2] = await registerUsers(4);
      await makeAdmin(admin);
      const video_id = await postVideo(author);
      await report(r1, 'video', video_id);
      await report(r2, 'video', video_id); // same target, two reports

      const res = await resolve(admin, { target_type: 'video', target_id: video_id, action: 'remove_content', note: 'off' });
      expect(res.status).toBe(200);
      expect(res.body.data.resolved_count).toBe(2); // both closed by one call

      // The video is really gone (paranoid soft-delete → findByPk returns null).
      expect(await Video.findByPk(video_id)).toBeNull();
      // And both reports are now actioned.
      const actioned = await api().get(path('/admin/reports?status=actioned&target_type=video')).set('Authorization', bearer(admin));
      expect(actioned.body.items.filter((r: { target_id: string }) => r.target_id === video_id)).toHaveLength(2);
    });

    it('suspend_user deactivates the account — the user can no longer authenticate', async () => {
      const [admin, reporter, badUser] = await registerUsers(3);
      await makeAdmin(admin);
      await report(reporter, 'user', badUser.id);

      // Before: the user's token works.
      expect((await api().get(path('/notifications')).set('Authorization', bearer(badUser))).status).toBe(200);

      const res = await resolve(admin, { target_type: 'user', target_id: badUser.id, action: 'suspend_user' });
      expect(res.body.data.resolved_count).toBe(1);

      // After: the auth middleware rejects a deactivated account (403, not 401).
      expect((await api().get(path('/notifications')).set('Authorization', bearer(badUser))).status).toBe(403);
    });

    it('dismiss closes the report with no side effect on the target', async () => {
      const [admin, reporter, target] = await registerUsers(3);
      await makeAdmin(admin);
      await report(reporter, 'user', target.id);

      const res = await resolve(admin, { target_type: 'user', target_id: target.id, action: 'dismiss' });
      expect(res.body.data.resolved_count).toBe(1);
      // Target still active — dismiss touched nothing but the report.
      expect((await api().get(path('/notifications')).set('Authorization', bearer(target))).status).toBe(200);
    });
  });

  describe('post targets', () => {
    it('remove_content soft-deletes a post AND closes its pending reports; the detail view hydrates it', async () => {
      const [admin, author, reporter] = await registerUsers(3);
      await makeAdmin(admin);
      const post_id = await createPost(author);
      await report(reporter, 'post', post_id, 'Intellectual property');

      // Detail view hydrates the post target.
      const listed = await api().get(path('/admin/reports?target_type=post')).set('Authorization', bearer(admin));
      const reportId = listed.body.items.find((r: { target_id: string }) => r.target_id === post_id).id;
      const detail = await api().get(path(`/admin/reports/${reportId}`)).set('Authorization', bearer(admin));
      expect(detail.body.data.target).toMatchObject({ type: 'post', id: post_id, author_id: author.id });

      const res = await resolve(admin, { target_type: 'post', target_id: post_id, action: 'remove_content' });
      expect(res.status).toBe(200);
      expect(res.body.data.resolved_count).toBe(1);
      // Paranoid soft-delete → findByPk returns null, but the row survives for appeal.
      expect(await Post.findByPk(post_id)).toBeNull();
      expect(await Post.findByPk(post_id, { paranoid: false })).not.toBeNull();
    });

    it('remove_content hard-deletes a post comment', async () => {
      const [admin, author, reporter] = await registerUsers(3);
      await makeAdmin(admin);
      const post_id = await createPost(author);
      const commentId = await postCommentOn(author, post_id);
      await report(reporter, 'post_comment', commentId);

      const res = await resolve(admin, { target_type: 'post_comment', target_id: commentId, action: 'remove_content' });
      expect(res.status).toBe(200);
      expect(res.body.data.resolved_count).toBe(1);
      // Not paranoid → the row is really gone.
      expect(await PostComment.findByPk(commentId)).toBeNull();
    });
  });

  describe('resolution guards', () => {
    it('rejects an action that does not match the target type (400)', async () => {
      const [admin, target] = await registerUsers(2);
      await makeAdmin(admin);
      // remove_content on a USER target is nonsensical.
      const res = await resolve(admin, { target_type: 'user', target_id: target.id, action: 'remove_content' });
      expect(res.status).toBe(400);
    });

    it('resolving a target with nothing pending returns 0, not an error', async () => {
      const [admin, target] = await registerUsers(2);
      await makeAdmin(admin);
      const res = await resolve(admin, { target_type: 'user', target_id: target.id, action: 'dismiss' });
      expect(res.status).toBe(200);
      expect(res.body.data.resolved_count).toBe(0);
    });

    it('is idempotent — re-resolving an already-resolved target closes nothing new', async () => {
      const [admin, reporter, target] = await registerUsers(3);
      await makeAdmin(admin);
      await report(reporter, 'user', target.id);
      await resolve(admin, { target_type: 'user', target_id: target.id, action: 'dismiss' });
      const again = await resolve(admin, { target_type: 'user', target_id: target.id, action: 'dismiss' });
      expect(again.body.data.resolved_count).toBe(0);
    });
  });
});
