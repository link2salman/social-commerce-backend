import { api, path } from '../helpers/app';
import { registerUser, registerUsers, bearer, type TestUser } from '../helpers/factories';

const USER_LIST_PAGE_SIZE = 6; // socialService.USER_LIST_PAGE_SIZE

const profile = (viewer: TestUser, targetId: string) =>
  api().get(path(`/users/${targetId}`)).set('Authorization', bearer(viewer));

describe('social graph', () => {
  describe('GET /users/:id', () => {
    it('returns the full User shape with viewer state and stats', async () => {
      const [viewer, target] = await registerUsers(2);
      const res = await profile(viewer, target.id);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: target.id,
        username: target.username,
        displayName: target.username, // signup seeds displayName from username
        avatarUrl: null,
        bio: '',
        stats: { followers: 0, following: 0, likes: 0, videos: 0 },
        viewer: {
          isSelf: false,
          isFollowing: false,
          isFollowedBy: false,
          friendStatus: 'none',
          isBlocked: false,
        },
      });
    });

    it('marks the caller as isSelf on their own profile', async () => {
      const user = await registerUser();
      const res = await profile(user, user.id);

      expect(res.status).toBe(200);
      expect(res.body.viewer.isSelf).toBe(true);
    });

    it('404s for a user that does not exist', async () => {
      const viewer = await registerUser();
      const res = await profile(viewer, '00000000-0000-4000-8000-000000000000');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('User not found');
    });

    it('400s for a malformed uuid rather than leaking a 500', async () => {
      const viewer = await registerUser();
      const res = await profile(viewer, 'not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid request parameter');
    });
  });

  describe('follow / unfollow', () => {
    it('follows, reflects on both profiles, then unfollows', async () => {
      const [alice, bob] = await registerUsers(2);

      const followed = await api()
        .post(path(`/users/${bob.id}/follow`))
        .set('Authorization', bearer(alice));
      expect(followed.status).toBe(200);
      expect(followed.body).toEqual({ ok: true });

      // Alice's view of Bob: she follows him, he does not follow back.
      const aliceSeesBob = await profile(alice, bob.id);
      expect(aliceSeesBob.body.viewer.isFollowing).toBe(true);
      expect(aliceSeesBob.body.viewer.isFollowedBy).toBe(false);
      expect(aliceSeesBob.body.stats.followers).toBe(1);

      // Bob's view of Alice is the mirror image.
      const bobSeesAlice = await profile(bob, alice.id);
      expect(bobSeesAlice.body.viewer.isFollowing).toBe(false);
      expect(bobSeesAlice.body.viewer.isFollowedBy).toBe(true);
      expect(bobSeesAlice.body.stats.following).toBe(1);

      const unfollowed = await api()
        .delete(path(`/users/${bob.id}/follow`))
        .set('Authorization', bearer(alice));
      expect(unfollowed.status).toBe(200);

      const after = await profile(alice, bob.id);
      expect(after.body.viewer.isFollowing).toBe(false);
      expect(after.body.stats.followers).toBe(0);
    });

    it('is idempotent — following twice leaves exactly one edge', async () => {
      const [alice, bob] = await registerUsers(2);
      const url = path(`/users/${bob.id}/follow`);

      await api().post(url).set('Authorization', bearer(alice));
      const second = await api().post(url).set('Authorization', bearer(alice));

      expect(second.status).toBe(200);
      const res = await profile(alice, bob.id);
      expect(res.body.stats.followers).toBe(1);
    });

    it('refuses a self-follow', async () => {
      const alice = await registerUser();
      const res = await api()
        .post(path(`/users/${alice.id}/follow`))
        .set('Authorization', bearer(alice));

      expect(res.status).toBe(404);
    });

    it('404s when following a user that does not exist', async () => {
      const alice = await registerUser();
      const res = await api()
        .post(path('/users/00000000-0000-4000-8000-000000000000/follow'))
        .set('Authorization', bearer(alice));

      expect(res.status).toBe(404);
    });

    it('requires auth', async () => {
      const bob = await registerUser();
      const res = await api().post(path(`/users/${bob.id}/follow`));

      expect(res.status).toBe(401);
    });
  });

  describe('friend requests', () => {
    it('sends, appears as incoming/outgoing, then accepts into a friendship', async () => {
      const [alice, bob] = await registerUsers(2);

      const sent = await api()
        .post(path(`/users/${bob.id}/friend-request`))
        .set('Authorization', bearer(alice));
      expect(sent.status).toBe(200);
      expect(sent.body).toEqual({ ok: true });

      // Directional status: outgoing for the requester, incoming for the addressee.
      expect((await profile(alice, bob.id)).body.viewer.friendStatus).toBe('outgoing');
      expect((await profile(bob, alice.id)).body.viewer.friendStatus).toBe('incoming');

      // Bob's inbox lists Alice as a UserSummary — {items} only, no cursor.
      const inbox = await api()
        .get(path('/friend-requests'))
        .set('Authorization', bearer(bob));
      expect(inbox.status).toBe(200);
      expect(Object.keys(inbox.body)).toEqual(['items']);
      expect(inbox.body.items).toHaveLength(1);
      expect(inbox.body.items[0]).toEqual({
        id: alice.id,
        username: alice.username,
        displayName: alice.username,
        avatarUrl: null,
        viewer: { isSelf: false, isFollowing: false, friendStatus: 'incoming' },
      });

      const accepted = await api()
        .post(path(`/users/${alice.id}/friend-request/accept`))
        .set('Authorization', bearer(bob));
      expect(accepted.status).toBe(200);

      expect((await profile(alice, bob.id)).body.viewer.friendStatus).toBe('friends');
      expect((await profile(bob, alice.id)).body.viewer.friendStatus).toBe('friends');

      // The request has left Bob's inbox.
      const afterInbox = await api()
        .get(path('/friend-requests'))
        .set('Authorization', bearer(bob));
      expect(afterInbox.body.items).toHaveLength(0);
    });

    it('treats a reciprocal request as an acceptance', async () => {
      const [alice, bob] = await registerUsers(2);

      await api()
        .post(path(`/users/${bob.id}/friend-request`))
        .set('Authorization', bearer(alice));
      // Bob independently asks Alice — the natural outcome is "now friends".
      await api()
        .post(path(`/users/${alice.id}/friend-request`))
        .set('Authorization', bearer(bob));

      expect((await profile(alice, bob.id)).body.viewer.friendStatus).toBe('friends');
      expect((await profile(bob, alice.id)).body.viewer.friendStatus).toBe('friends');
    });

    it('lists friends and removes a friendship', async () => {
      const [alice, bob] = await registerUsers(2);
      await api()
        .post(path(`/users/${bob.id}/friend-request`))
        .set('Authorization', bearer(alice));
      await api()
        .post(path(`/users/${alice.id}/friend-request/accept`))
        .set('Authorization', bearer(bob));

      const friends = await api()
        .get(path(`/users/${alice.id}/friends`))
        .set('Authorization', bearer(alice));
      expect(friends.status).toBe(200);
      expect(friends.body.items).toHaveLength(1);
      expect(friends.body.items[0].id).toBe(bob.id);
      expect(friends.body.nextCursor).toBeNull();

      const removed = await api()
        .delete(path(`/users/${bob.id}/friend`))
        .set('Authorization', bearer(alice));
      expect(removed.status).toBe(200);

      expect((await profile(alice, bob.id)).body.viewer.friendStatus).toBe('none');
      const afterList = await api()
        .get(path(`/users/${alice.id}/friends`))
        .set('Authorization', bearer(alice));
      expect(afterList.body.items).toHaveLength(0);
    });

    it('refuses a self friend-request', async () => {
      const alice = await registerUser();
      const res = await api()
        .post(path(`/users/${alice.id}/friend-request`))
        .set('Authorization', bearer(alice));

      expect(res.status).toBe(404);
    });
  });

  describe('POST /users/:id/block', () => {
    it('severs the follow graph BOTH ways and clears the friendship', async () => {
      const [alice, bob] = await registerUsers(2);

      // Build a fully entangled relationship: mutual follows + an accepted friendship.
      await api().post(path(`/users/${bob.id}/follow`)).set('Authorization', bearer(alice));
      await api().post(path(`/users/${alice.id}/follow`)).set('Authorization', bearer(bob));
      await api()
        .post(path(`/users/${bob.id}/friend-request`))
        .set('Authorization', bearer(alice));
      await api()
        .post(path(`/users/${alice.id}/friend-request/accept`))
        .set('Authorization', bearer(bob));

      const entangled = await profile(alice, bob.id);
      expect(entangled.body.viewer).toMatchObject({
        isFollowing: true,
        isFollowedBy: true,
        friendStatus: 'friends',
      });

      const blocked = await api()
        .post(path(`/users/${bob.id}/block`))
        .set('Authorization', bearer(alice));
      expect(blocked.status).toBe(200);

      // Alice's side: every edge gone, block recorded.
      const aliceSeesBob = await profile(alice, bob.id);
      expect(aliceSeesBob.body.viewer).toEqual({
        isSelf: false,
        isFollowing: false,
        isFollowedBy: false,
        friendStatus: 'none',
        isBlocked: true,
      });
      expect(aliceSeesBob.body.stats.followers).toBe(0);
      expect(aliceSeesBob.body.stats.following).toBe(0);

      // Bob's side: the edges are gone for him too (the sever is symmetric), but
      // the block itself is one-directional — he is not shown as blocking her.
      const bobSeesAlice = await profile(bob, alice.id);
      expect(bobSeesAlice.body.viewer).toEqual({
        isSelf: false,
        isFollowing: false,
        isFollowedBy: false,
        friendStatus: 'none',
        isBlocked: false,
      });

      // Both follower/following lists are empty on each side.
      const bobFollowers = await api()
        .get(path(`/users/${bob.id}/followers`))
        .set('Authorization', bearer(bob));
      expect(bobFollowers.body.items).toHaveLength(0);
      const aliceFollowers = await api()
        .get(path(`/users/${alice.id}/followers`))
        .set('Authorization', bearer(alice));
      expect(aliceFollowers.body.items).toHaveLength(0);
    });

    it('hides the blocked user from search, and unblocking restores them', async () => {
      const alice = await registerUser();
      const bob = await registerUser({ username: `blocktarget${Date.now() % 100000}` });

      const before = await api()
        .get(path('/users/search'))
        .query({ q: bob.username })
        .set('Authorization', bearer(alice));
      expect(before.body.items.map((u: { id: string }) => u.id)).toContain(bob.id);

      await api().post(path(`/users/${bob.id}/block`)).set('Authorization', bearer(alice));

      const during = await api()
        .get(path('/users/search'))
        .query({ q: bob.username })
        .set('Authorization', bearer(alice));
      expect(during.body.items).toHaveLength(0);

      const unblocked = await api()
        .delete(path(`/users/${bob.id}/block`))
        .set('Authorization', bearer(alice));
      expect(unblocked.status).toBe(200);

      const after = await api()
        .get(path('/users/search'))
        .query({ q: bob.username })
        .set('Authorization', bearer(alice));
      expect(after.body.items.map((u: { id: string }) => u.id)).toContain(bob.id);
      expect((await profile(alice, bob.id)).body.viewer.isBlocked).toBe(false);
    });

    it('refuses a self-block', async () => {
      const alice = await registerUser();
      const res = await api()
        .post(path(`/users/${alice.id}/block`))
        .set('Authorization', bearer(alice));

      expect(res.status).toBe(404);
    });
  });

  describe('GET /users/search', () => {
    it('matches on username and on displayName, case-insensitively', async () => {
      const viewer = await registerUser();
      const stamp = Date.now().toString(36).slice(-6);
      const target = await registerUser({ username: `searchme${stamp}` });

      await api()
        .patch(path('/users/me'))
        .set('Authorization', bearer(target))
        .send({ displayName: `Zaphod ${stamp}` });

      const byUsername = await api()
        .get(path('/users/search'))
        .query({ q: `SEARCHME${stamp.toUpperCase()}` })
        .set('Authorization', bearer(viewer));
      expect(byUsername.status).toBe(200);
      expect(byUsername.body.items.map((u: { id: string }) => u.id)).toEqual([target.id]);

      const byDisplayName = await api()
        .get(path('/users/search'))
        .query({ q: 'zaphod' })
        .set('Authorization', bearer(viewer));
      expect(byDisplayName.body.items.map((u: { id: string }) => u.id)).toEqual([target.id]);
    });

    it('never returns the caller', async () => {
      const viewer = await registerUser({ username: `selfsearch${Date.now() % 100000}` });
      const res = await api()
        .get(path('/users/search'))
        .query({ q: viewer.username })
        .set('Authorization', bearer(viewer));

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
    });

    it('returns an empty list for a blank query', async () => {
      const viewer = await registerUser();
      const res = await api()
        .get(path('/users/search'))
        .query({ q: '   ' })
        .set('Authorization', bearer(viewer));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });

    it('carries the viewer-relative relationship on each hit', async () => {
      const viewer = await registerUser();
      const target = await registerUser({ username: `relhit${Date.now() % 100000}` });
      await api()
        .post(path(`/users/${target.id}/follow`))
        .set('Authorization', bearer(viewer));

      const res = await api()
        .get(path('/users/search'))
        .query({ q: target.username })
        .set('Authorization', bearer(viewer));

      expect(res.body.items[0].viewer).toEqual({
        isSelf: false,
        isFollowing: true,
        friendStatus: 'none',
      });
    });
  });

  describe('followers / following pagination', () => {
    it('pages followers with an opaque cursor and no overlap between pages', async () => {
      const target = await registerUser();
      const followers = await registerUsers(USER_LIST_PAGE_SIZE + 1); // 7

      for (const follower of followers) {
        const res = await api()
          .post(path(`/users/${target.id}/follow`))
          .set('Authorization', bearer(follower));
        expect(res.status).toBe(200);
      }

      const first = await api()
        .get(path(`/users/${target.id}/followers`))
        .set('Authorization', bearer(target));

      expect(first.status).toBe(200);
      // The page shape the app's useInfiniteQuery expects.
      expect(Object.keys(first.body).sort()).toEqual(['items', 'nextCursor']);
      expect(first.body.items).toHaveLength(USER_LIST_PAGE_SIZE);
      expect(typeof first.body.nextCursor).toBe('string');
      expect(first.body.nextCursor.length).toBeGreaterThan(0);

      // Every item is a UserSummary — never the full User (no stats key).
      for (const item of first.body.items) {
        expect(Object.keys(item).sort()).toEqual([
          'avatarUrl',
          'displayName',
          'id',
          'username',
          'viewer',
        ]);
        expect(Object.keys(item.viewer).sort()).toEqual([
          'friendStatus',
          'isFollowing',
          'isSelf',
        ]);
      }

      const second = await api()
        .get(path(`/users/${target.id}/followers`))
        .query({ cursor: first.body.nextCursor })
        .set('Authorization', bearer(target));

      expect(second.status).toBe(200);
      expect(second.body.items).toHaveLength(1);
      // Last page → the client stops.
      expect(second.body.nextCursor).toBeNull();

      const firstIds = first.body.items.map((u: { id: string }) => u.id);
      const secondIds = second.body.items.map((u: { id: string }) => u.id);
      expect(firstIds.filter((id: string) => secondIds.includes(id))).toHaveLength(0);
      expect(new Set([...firstIds, ...secondIds]).size).toBe(followers.length);
    });

    it('pages following the same way', async () => {
      const viewer = await registerUser();
      const targets = await registerUsers(USER_LIST_PAGE_SIZE + 1);

      for (const target of targets) {
        await api()
          .post(path(`/users/${target.id}/follow`))
          .set('Authorization', bearer(viewer));
      }

      const first = await api()
        .get(path(`/users/${viewer.id}/following`))
        .set('Authorization', bearer(viewer));
      expect(first.body.items).toHaveLength(USER_LIST_PAGE_SIZE);
      expect(typeof first.body.nextCursor).toBe('string');
      // The viewer follows everyone in their own following list.
      expect(
        first.body.items.every((u: { viewer: { isFollowing: boolean } }) => u.viewer.isFollowing)
      ).toBe(true);

      const second = await api()
        .get(path(`/users/${viewer.id}/following`))
        .query({ cursor: first.body.nextCursor })
        .set('Authorization', bearer(viewer));
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();
    });

    it('returns an empty page (nextCursor null) when there is nothing to list', async () => {
      const user = await registerUser();
      const res = await api()
        .get(path(`/users/${user.id}/followers`))
        .set('Authorization', bearer(user));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
    });

    it('treats a malformed cursor as "start from the beginning"', async () => {
      const target = await registerUser();
      const follower = await registerUser();
      await api()
        .post(path(`/users/${target.id}/follow`))
        .set('Authorization', bearer(follower));

      const res = await api()
        .get(path(`/users/${target.id}/followers`))
        .query({ cursor: 'not-a-real-cursor' })
        .set('Authorization', bearer(target));

      // The client only ever round-trips a cursor we minted, so garbage is a
      // first page rather than a 400.
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    });
  });

  describe('PATCH /users/me', () => {
    it('updates the profile and returns the caller as isSelf', async () => {
      const user = await registerUser();
      const res = await api()
        .patch(path('/users/me'))
        .set('Authorization', bearer(user))
        .send({ displayName: 'Ford Prefect', bio: 'Mostly harmless.' });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Ford Prefect');
      expect(res.body.bio).toBe('Mostly harmless.');
      expect(res.body.viewer.isSelf).toBe(true);
      expect(res.body.id).toBe(user.id);
    });

    it('clears the avatar when avatarUrl is explicitly null', async () => {
      const user = await registerUser();
      await api()
        .patch(path('/users/me'))
        .set('Authorization', bearer(user))
        .send({ avatarUrl: 'https://cdn.example.test/me.png' });

      const res = await api()
        .patch(path('/users/me'))
        .set('Authorization', bearer(user))
        .send({ avatarUrl: null });

      expect(res.status).toBe(200);
      expect(res.body.avatarUrl).toBeNull();
    });

    it('400s on an empty patch', async () => {
      const user = await registerUser();
      const res = await api()
        .patch(path('/users/me'))
        .set('Authorization', bearer(user))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
    });

    it('400s on a non-URL avatarUrl', async () => {
      const user = await registerUser();
      const res = await api()
        .patch(path('/users/me'))
        .set('Authorization', bearer(user))
        .send({ avatarUrl: 'nope' });

      expect(res.status).toBe(400);
    });
  });
});
