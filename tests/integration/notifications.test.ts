import { api, path } from '../helpers/app';
import { bearer, registerUser, registerUsers, type TestUser } from '../helpers/factories';

// The durable feed behind the FCM pushes. These tests drive the REAL triggering
// endpoints (follow, friend-request, comment) and assert the row that results,
// so they also prove the socialService ↔ notificationService wiring resolves at
// runtime (the two import each other).

const follow = (actor: TestUser, target: TestUser) =>
  api().post(path(`/users/${target.id}/follow`)).set('Authorization', bearer(actor));

const friendRequest = (actor: TestUser, target: TestUser) =>
  api().post(path(`/users/${target.id}/friend-request`)).set('Authorization', bearer(actor));

const acceptFriend = (actor: TestUser, requester: TestUser) =>
  api().post(path(`/users/${requester.id}/friend-request/accept`)).set('Authorization', bearer(actor));

const postVideo = async (author: TestUser): Promise<string> => {
  const res = await api().post(path('/videos')).set('Authorization', bearer(author)).send({
    videoUrl: 'https://cdn.example.test/clip.mp4',
    thumbnailUrl: 'https://cdn.example.test/poster.jpg',
    caption: 'clip',
    durationMs: 12_000,
    soundName: null,
    productIds: [],
  });
  return res.body.id as string;
};

const comment = (author: TestUser, videoId: string, body: string, parentId?: string) =>
  api()
    .post(path(`/videos/${videoId}/comments`))
    .set('Authorization', bearer(author))
    .send({ body, ...(parentId ? { parentId } : {}) });

const like = (actor: TestUser, videoId: string) =>
  api().post(path(`/videos/${videoId}/like`)).set('Authorization', bearer(actor));

const listFor = (u: TestUser) =>
  api().get(path('/notifications')).set('Authorization', bearer(u));

describe('notifications', () => {
  describe('creation from real triggers', () => {
    it('a follow creates a follow notification whose actor + target is the follower', async () => {
      const [alice, bob] = await registerUsers(2);
      await follow(alice, bob);

      const res = await listFor(bob);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        type: 'follow',
        actor: { id: alice.id },
        target: { type: 'user', id: alice.id },
        isRead: false,
      });
    });

    it('a friend request, then its acceptance, each notify the right person', async () => {
      const [alice, bob] = await registerUsers(2);
      await friendRequest(alice, bob);
      expect((await listFor(bob)).body.items[0]).toMatchObject({
        type: 'friend_request',
        actor: { id: alice.id },
      });

      await acceptFriend(bob, alice);
      // Alice (the original requester) is told bob accepted.
      expect((await listFor(alice)).body.items[0]).toMatchObject({
        type: 'friend_accept',
        actor: { id: bob.id },
      });
    });

    it('a like on a video notifies the author, once, and never for a self-like', async () => {
      const [author, liker] = await registerUsers(2);
      const videoId = await postVideo(author);

      await like(liker, videoId);
      const res = await listFor(author);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        type: 'like',
        actor: { id: liker.id },
        target: { type: 'video', id: videoId },
        isRead: false,
      });

      // Liking an already-liked video (findOrCreate.created === false) does not
      // duplicate the notification.
      await like(liker, videoId);
      expect((await listFor(author)).body.items).toHaveLength(1);

      // A self-like adds nothing to the author's own feed.
      await like(author, videoId);
      expect((await listFor(author)).body.items).toHaveLength(1);
    });

    it('a comment notifies the video author; a reply notifies the replied-to author', async () => {
      const [author, commenter, replier] = await registerUsers(3);
      const videoId = await postVideo(author);

      const c = await comment(commenter, videoId, 'nice');
      expect((await listFor(author)).body.items[0]).toMatchObject({
        type: 'comment',
        actor: { id: commenter.id },
        target: { type: 'video', id: videoId },
      });

      await comment(replier, videoId, 'agreed', c.body.id);
      // The commenter (parent author) is notified of the reply, not the video author.
      expect((await listFor(commenter)).body.items[0]).toMatchObject({
        type: 'comment_reply',
        actor: { id: replier.id },
        target: { type: 'video', id: videoId },
      });
    });

    it('never notifies a user about their own action', async () => {
      const author = await registerUser();
      const videoId = await postVideo(author);
      await comment(author, videoId, 'self comment on own video');

      const res = await listFor(author);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('list, unread count, mark read', () => {
    it('lists newest-first and paginates by cursor', async () => {
      const recipient = await registerUser();
      const actors = await registerUsers(3);
      // Three follows → three notifications, in order.
      for (const a of actors) await follow(a, recipient);

      const page1 = await api()
        .get(path('/notifications?limit=2'))
        .set('Authorization', bearer(recipient));
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.nextCursor).toEqual(expect.any(String));
      // Newest first: the last actor followed appears first.
      expect(page1.body.items[0].actor.id).toBe(actors[2].id);

      const page2 = await api()
        .get(path(`/notifications?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`))
        .set('Authorization', bearer(recipient));
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].actor.id).toBe(actors[0].id);
      expect(page2.body.nextCursor).toBeNull();
    });

    it('reports and decrements the unread count', async () => {
      const [recipient, a, b] = await registerUsers(3);
      await follow(a, recipient);
      await follow(b, recipient);

      expect((await api().get(path('/notifications/unread-count')).set('Authorization', bearer(recipient))).body)
        .toEqual({ count: 2 });

      const marked = await api().post(path('/notifications/read')).set('Authorization', bearer(recipient)).send({});
      expect(marked.body).toEqual({ count: 2 });

      expect((await api().get(path('/notifications/unread-count')).set('Authorization', bearer(recipient))).body)
        .toEqual({ count: 0 });
    });

    it('marks only the given ids when ids are supplied', async () => {
      const [recipient, a, b] = await registerUsers(3);
      await follow(a, recipient);
      await follow(b, recipient);
      const items = (await listFor(recipient)).body.items as Array<{ id: string; isRead: boolean }>;

      const res = await api()
        .post(path('/notifications/read'))
        .set('Authorization', bearer(recipient))
        .send({ ids: [items[0]!.id] });
      expect(res.body).toEqual({ count: 1 });

      const after = (await listFor(recipient)).body.items as Array<{ id: string; isRead: boolean }>;
      expect(after.find(n => n.id === items[0]!.id)!.isRead).toBe(true);
      expect(after.find(n => n.id === items[1]!.id)!.isRead).toBe(false);
    });

    it('is idempotent — marking already-read rows reports 0 newly changed', async () => {
      const [recipient, a] = await registerUsers(2);
      await follow(a, recipient);
      await api().post(path('/notifications/read')).set('Authorization', bearer(recipient)).send({});
      const second = await api().post(path('/notifications/read')).set('Authorization', bearer(recipient)).send({});
      expect(second.body).toEqual({ count: 0 });
    });
  });

  describe('ownership + auth', () => {
    it("one user cannot read or mark another user's notifications", async () => {
      const [recipient, actor, stranger] = await registerUsers(3);
      await follow(actor, recipient);
      const mine = (await listFor(recipient)).body.items as Array<{ id: string }>;

      // The stranger's feed is empty...
      expect((await listFor(stranger)).body.items).toEqual([]);
      // ...and trying to mark the recipient's id read affects nothing.
      const res = await api()
        .post(path('/notifications/read'))
        .set('Authorization', bearer(stranger))
        .send({ ids: [mine[0]!.id] });
      expect(res.body).toEqual({ count: 0 });
      // The recipient's row is still unread.
      expect((await listFor(recipient)).body.items[0].isRead).toBe(false);
    });

    it('rejects unauthenticated access (401)', async () => {
      expect((await api().get(path('/notifications'))).status).toBe(401);
      expect((await api().get(path('/notifications/unread-count'))).status).toBe(401);
      expect((await api().post(path('/notifications/read')).send({})).status).toBe(401);
    });

    it('rejects a malformed id in the mark-read body (400)', async () => {
      const u = await registerUser();
      const res = await api()
        .post(path('/notifications/read'))
        .set('Authorization', bearer(u))
        .send({ ids: ['not-a-uuid'] });
      expect(res.status).toBe(400);
    });
  });
});
