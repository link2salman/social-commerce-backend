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
    videoUrl: 'https://cdn.example.test/clip.mp4',
    thumbnailUrl: 'https://cdn.example.test/poster.jpg',
    caption: 'reported clip',
    durationMs: 12_000,
    soundName: null,
    productIds: [],
  });
  return res.body.id as string;
};

const createPost = async (author: TestUser, body = 'reported post'): Promise<string> => {
  const res = await api().post(path('/posts')).set('Authorization', bearer(author)).send({ body, imageUrls: [] });
  return res.body.id as string;
};

const postCommentOn = async (author: TestUser, postId: string, body = 'reported comment'): Promise<string> => {
  const res = await api().post(path(`/posts/${postId}/comments`)).set('Authorization', bearer(author)).send({ body });
  return res.body.id as string;
};

const report = (reporter: TestUser, targetType: string, targetId: string, reason = 'Spam or scam') =>
  api().post(path('/reports')).set('Authorization', bearer(reporter)).send({ targetType, targetId, reason });

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
        targetType: 'user', targetId: user.id, action: 'dismiss',
      })).status).toBe(403);
    });

    it('an unauthenticated request gets 401', async () => {
      expect((await api().get(path('/admin/reports'))).status).toBe(401);
      expect((await api().post(path('/admin/reports/resolve')).send({})).status).toBe(401);
    });

    it('exposes isAdmin:true on a moderator’s OWN profile (the app gates the console on it)', async () => {
      const admin = await registerUser();
      await makeAdmin(admin);
      const self = await api().get(path(`/users/${admin.id}`)).set('Authorization', bearer(admin));
      expect(self.body.isAdmin).toBe(true);
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
      const reportId = listed.body.items.find((r: { targetId: string }) => r.targetId === target.id).id;

      const detail = await api().get(path(`/admin/reports/${reportId}`)).set('Authorization', bearer(admin));
      expect(detail.status).toBe(200);
      expect(detail.body.target).toMatchObject({ type: 'user', id: target.id });

      // A report against a comment id that doesn't exist → target null, still 200.
      await report(reporter, 'comment', '11111111-1111-1111-1111-111111111111');
      const ghost = await api().get(path('/admin/reports?targetType=comment')).set('Authorization', bearer(admin));
      const ghostDetail = await api().get(path(`/admin/reports/${ghost.body.items[0].id}`)).set('Authorization', bearer(admin));
      expect(ghostDetail.status).toBe(200);
      expect(ghostDetail.body.target).toBeNull();
    });
  });

  describe('resolution actually affects the target', () => {
    it('remove_content soft-deletes the video AND closes every pending report against it', async () => {
      const [admin, author, r1, r2] = await registerUsers(4);
      await makeAdmin(admin);
      const videoId = await postVideo(author);
      await report(r1, 'video', videoId);
      await report(r2, 'video', videoId); // same target, two reports

      const res = await resolve(admin, { targetType: 'video', targetId: videoId, action: 'remove_content', note: 'off' });
      expect(res.status).toBe(200);
      expect(res.body.resolvedCount).toBe(2); // both closed by one call

      // The video is really gone (paranoid soft-delete → findByPk returns null).
      expect(await Video.findByPk(videoId)).toBeNull();
      // And both reports are now actioned.
      const actioned = await api().get(path('/admin/reports?status=actioned&targetType=video')).set('Authorization', bearer(admin));
      expect(actioned.body.items.filter((r: { targetId: string }) => r.targetId === videoId)).toHaveLength(2);
    });

    it('suspend_user deactivates the account — the user can no longer authenticate', async () => {
      const [admin, reporter, badUser] = await registerUsers(3);
      await makeAdmin(admin);
      await report(reporter, 'user', badUser.id);

      // Before: the user's token works.
      expect((await api().get(path('/notifications')).set('Authorization', bearer(badUser))).status).toBe(200);

      const res = await resolve(admin, { targetType: 'user', targetId: badUser.id, action: 'suspend_user' });
      expect(res.body.resolvedCount).toBe(1);

      // After: the auth middleware rejects a deactivated account (403, not 401).
      expect((await api().get(path('/notifications')).set('Authorization', bearer(badUser))).status).toBe(403);
    });

    it('dismiss closes the report with no side effect on the target', async () => {
      const [admin, reporter, target] = await registerUsers(3);
      await makeAdmin(admin);
      await report(reporter, 'user', target.id);

      const res = await resolve(admin, { targetType: 'user', targetId: target.id, action: 'dismiss' });
      expect(res.body.resolvedCount).toBe(1);
      // Target still active — dismiss touched nothing but the report.
      expect((await api().get(path('/notifications')).set('Authorization', bearer(target))).status).toBe(200);
    });
  });

  describe('post targets', () => {
    it('remove_content soft-deletes a post AND closes its pending reports; the detail view hydrates it', async () => {
      const [admin, author, reporter] = await registerUsers(3);
      await makeAdmin(admin);
      const postId = await createPost(author);
      await report(reporter, 'post', postId, 'Intellectual property');

      // Detail view hydrates the post target.
      const listed = await api().get(path('/admin/reports?targetType=post')).set('Authorization', bearer(admin));
      const reportId = listed.body.items.find((r: { targetId: string }) => r.targetId === postId).id;
      const detail = await api().get(path(`/admin/reports/${reportId}`)).set('Authorization', bearer(admin));
      expect(detail.body.target).toMatchObject({ type: 'post', id: postId, authorId: author.id });

      const res = await resolve(admin, { targetType: 'post', targetId: postId, action: 'remove_content' });
      expect(res.status).toBe(200);
      expect(res.body.resolvedCount).toBe(1);
      // Paranoid soft-delete → findByPk returns null, but the row survives for appeal.
      expect(await Post.findByPk(postId)).toBeNull();
      expect(await Post.findByPk(postId, { paranoid: false })).not.toBeNull();
    });

    it('remove_content hard-deletes a post comment', async () => {
      const [admin, author, reporter] = await registerUsers(3);
      await makeAdmin(admin);
      const postId = await createPost(author);
      const commentId = await postCommentOn(author, postId);
      await report(reporter, 'post_comment', commentId);

      const res = await resolve(admin, { targetType: 'post_comment', targetId: commentId, action: 'remove_content' });
      expect(res.status).toBe(200);
      expect(res.body.resolvedCount).toBe(1);
      // Not paranoid → the row is really gone.
      expect(await PostComment.findByPk(commentId)).toBeNull();
    });
  });

  describe('resolution guards', () => {
    it('rejects an action that does not match the target type (400)', async () => {
      const [admin, target] = await registerUsers(2);
      await makeAdmin(admin);
      // remove_content on a USER target is nonsensical.
      const res = await resolve(admin, { targetType: 'user', targetId: target.id, action: 'remove_content' });
      expect(res.status).toBe(400);
    });

    it('resolving a target with nothing pending returns 0, not an error', async () => {
      const [admin, target] = await registerUsers(2);
      await makeAdmin(admin);
      const res = await resolve(admin, { targetType: 'user', targetId: target.id, action: 'dismiss' });
      expect(res.status).toBe(200);
      expect(res.body.resolvedCount).toBe(0);
    });

    it('is idempotent — re-resolving an already-resolved target closes nothing new', async () => {
      const [admin, reporter, target] = await registerUsers(3);
      await makeAdmin(admin);
      await report(reporter, 'user', target.id);
      await resolve(admin, { targetType: 'user', targetId: target.id, action: 'dismiss' });
      const again = await resolve(admin, { targetType: 'user', targetId: target.id, action: 'dismiss' });
      expect(again.body.resolvedCount).toBe(0);
    });
  });
});
