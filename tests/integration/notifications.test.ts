import http from 'http';
import { api, path } from '../helpers/app';
import { bearer, registerUser, registerUsers, type TestUser } from '../helpers/factories';
import { closeSocketManager, getSocketManager, initSocketManager } from 'socket';

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
    video_url: 'https://cdn.example.test/clip.mp4',
    thumbnail_url: 'https://cdn.example.test/poster.jpg',
    caption: 'clip',
    duration_ms: 12_000,
    sound_name: null,
    product_ids: [],
  });
  return res.body.data.id as string;
};

const comment = (author: TestUser, video_id: string, body: string, parent_id?: string) =>
  api()
    .post(path(`/videos/${video_id}/comments`))
    .set('Authorization', bearer(author))
    .send({ body, ...(parent_id ? { parent_id } : {}) });

const like = (actor: TestUser, video_id: string) =>
  api().post(path(`/videos/${video_id}/like`)).set('Authorization', bearer(actor));

const listFor = (u: TestUser) =>
  api().get(path('/notifications')).set('Authorization', bearer(u));

const unreadFor = async (u: TestUser): Promise<number> =>
  (
    await api().get(path('/notifications/unread-count')).set('Authorization', bearer(u))
  ).body.data.count as number;

const markAllRead = (u: TestUser) =>
  api().post(path('/notifications/read')).set('Authorization', bearer(u)).send({});

const openWith = async (viewer: TestUser, peer: TestUser): Promise<string> => {
  const res = await api()
    .post(path(`/conversations/with/${peer.id}`))
    .set('Authorization', bearer(viewer));
  return res.body.data.id as string;
};

const openGroup = async (
  owner: TestUser,
  members: TestUser[]
): Promise<string> => {
  const res = await api()
    .post(path('/conversations/group'))
    .set('Authorization', bearer(owner))
    .send({ title: 'crew', participant_ids: members.map(m => m.id) });
  return res.body.data.id as string;
};

const sendMessage = (sender: TestUser, conversation_id: string, body: string) =>
  api()
    .post(path(`/conversations/${conversation_id}/messages`))
    .set('Authorization', bearer(sender))
    .send({ body });

const readThread = (reader: TestUser, conversation_id: string) =>
  api()
    .get(path(`/conversations/${conversation_id}/messages`))
    .set('Authorization', bearer(reader));

const messageRows = (items: Array<{ type: string }>): Array<{ type: string }> =>
  items.filter(n => n.type === 'message');

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
        is_read: false,
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
      const video_id = await postVideo(author);

      await like(liker, video_id);
      const res = await listFor(author);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        type: 'like',
        actor: { id: liker.id },
        target: { type: 'video', id: video_id },
        is_read: false,
      });

      // Liking an already-liked video (findOrCreate.created === false) does not
      // duplicate the notification.
      await like(liker, video_id);
      expect((await listFor(author)).body.items).toHaveLength(1);

      // A self-like adds nothing to the author's own feed.
      await like(author, video_id);
      expect((await listFor(author)).body.items).toHaveLength(1);
    });

    it('a comment notifies the video author; a reply notifies the replied-to author', async () => {
      const [author, commenter, replier] = await registerUsers(3);
      const video_id = await postVideo(author);

      const c = await comment(commenter, video_id, 'nice');
      expect((await listFor(author)).body.items[0]).toMatchObject({
        type: 'comment',
        actor: { id: commenter.id },
        target: { type: 'video', id: video_id },
      });

      await comment(replier, video_id, 'agreed', c.body.data.id);
      // The commenter (parent author) is notified of the reply, not the video author.
      expect((await listFor(commenter)).body.items[0]).toMatchObject({
        type: 'comment_reply',
        actor: { id: replier.id },
        target: { type: 'video', id: video_id },
      });
    });

    it('never notifies a user about their own action', async () => {
      const author = await registerUser();
      const video_id = await postVideo(author);
      await comment(author, video_id, 'self comment on own video');

      const res = await listFor(author);
      expect(res.body.items).toEqual([]);
    });
  });

  // Chat used to write no rows at all. It now does — but COALESCED: one unread
  // row per (recipient, conversation), bumped per message. These tests pin that
  // rule, because undoing it turns a fifty-message thread into fifty rows.
  describe('chat messages (coalesced)', () => {
    it('a message notifies the recipient, targets the conversation, and never the sender', async () => {
      const [alice, bob] = await registerUsers(2);
      const conversation_id = await openWith(alice, bob);

      expect((await sendMessage(alice, conversation_id, 'hey')).status).toBe(201);

      const res = await listFor(bob);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        type: 'message',
        actor: { id: alice.id },
        target: { type: 'conversation', id: conversation_id },
        is_read: false,
      });
      // The sender is not notified of their own send.
      expect((await listFor(alice)).body.items).toEqual([]);
    });

    it('a group message notifies every OTHER member', async () => {
      const [alice, bob, carol] = await registerUsers(3);
      const conversation_id = await openGroup(alice, [bob, carol]);

      await sendMessage(alice, conversation_id, 'kickoff');

      for (const member of [bob, carol]) {
        const items = (await listFor(member)).body.items as Array<unknown>;
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
          type: 'message',
          actor: { id: alice.id },
          target: { type: 'conversation', id: conversation_id },
        });
      }
      expect((await listFor(alice)).body.items).toEqual([]);
    });

    it('five messages leave ONE unread row, not five', async () => {
      const [alice, bob] = await registerUsers(2);
      const conversation_id = await openWith(alice, bob);

      for (const body of ['1', '2', '3', '4', '5']) {
        await sendMessage(alice, conversation_id, body);
      }

      const items = (await listFor(bob)).body.items as Array<{ type: string }>;
      expect(messageRows(items)).toHaveLength(1);
      expect(items).toHaveLength(1);
      // The badge counts conversations, not messages.
      expect(await unreadFor(bob)).toBe(1);
    });

    it('bumps the existing row back to the top and re-points it at the latest sender', async () => {
      const [alice, bob, carol] = await registerUsers(3);
      const conversation_id = await openGroup(alice, [bob, carol]);

      await sendMessage(alice, conversation_id, 'first');
      // A newer, unrelated notification pushes the message row down…
      await follow(carol, bob);
      expect((await listFor(bob)).body.items[0].type).toBe('follow');

      // …and the next message in the thread bumps the SAME row back above it.
      await sendMessage(carol, conversation_id, 'second');
      const items = (await listFor(bob)).body.items as Array<{
        type: string;
        actor: { id: string };
      }>;
      expect(messageRows(items)).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: 'message', actor: { id: carol.id } });
    });

    it('starts a FRESH row once the recipient has read their notifications', async () => {
      const [alice, bob] = await registerUsers(2);
      const conversation_id = await openWith(alice, bob);

      await sendMessage(alice, conversation_id, 'one');
      await sendMessage(alice, conversation_id, 'two');
      expect(messageRows((await listFor(bob)).body.items)).toHaveLength(1);

      expect((await markAllRead(bob)).body.data).toEqual({ count: 1 });
      expect(await unreadFor(bob)).toBe(0);

      await sendMessage(alice, conversation_id, 'three');
      const items = (await listFor(bob)).body.items as Array<{
        type: string;
        is_read: boolean;
      }>;
      // Two rows now: the read history, and one new unread row on top.
      expect(messageRows(items)).toHaveLength(2);
      expect(items[0]).toMatchObject({ type: 'message', is_read: false });
      expect(items[1]).toMatchObject({ type: 'message', is_read: true });
      expect(await unreadFor(bob)).toBe(1);
    });

    // Reading the messages IS reading the notification about them. Without this
    // the badge could only be cleared from a screen the user has no reason to
    // open, which is a worse bug than the one this feature fixes.
    it('opening the thread marks its notification read and drops the badge', async () => {
      const [alice, bob] = await registerUsers(2);
      const conversation_id = await openWith(alice, bob);

      await sendMessage(alice, conversation_id, 'one');
      await sendMessage(alice, conversation_id, 'two');
      expect(await unreadFor(bob)).toBe(1);

      expect((await readThread(bob, conversation_id)).status).toBe(200);

      expect(await unreadFor(bob)).toBe(0);
      const items = (await listFor(bob)).body.items as Array<{
        type: string;
        is_read: boolean;
      }>;
      // Read, not deleted — the history stays in the feed.
      expect(messageRows(items)).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: 'message', is_read: true });
    });

    it('releases the coalescing slot — the next message starts a FRESH row', async () => {
      const [alice, bob] = await registerUsers(2);
      const conversation_id = await openWith(alice, bob);

      await sendMessage(alice, conversation_id, 'one');
      const firstId = (await listFor(bob)).body.items[0].id as string;
      await readThread(bob, conversation_id);

      // read_at is set, so the row left `notifications_message_unread_unique`
      // and this insert cannot collide with it.
      await sendMessage(alice, conversation_id, 'two');
      const items = (await listFor(bob)).body.items as Array<{
        id: string;
        type: string;
        is_read: boolean;
      }>;
      expect(messageRows(items)).toHaveLength(2);
      expect(items[0]).toMatchObject({ type: 'message', is_read: false });
      expect(items[0]!.id).not.toBe(firstId);
      expect(items[1]).toMatchObject({ id: firstId, is_read: true });
      expect(await unreadFor(bob)).toBe(1);
    });

    it('clears ONLY the thread that was opened, and only for its reader', async () => {
      const [alice, bob, carol] = await registerUsers(3);
      const withAlice = await openWith(alice, bob);
      const withCarol = await openWith(carol, bob);
      await sendMessage(alice, withAlice, 'a');
      await sendMessage(carol, withCarol, 'c');
      // A non-message row must be untouched too.
      await follow(carol, bob);
      expect(await unreadFor(bob)).toBe(3);

      await readThread(bob, withAlice);

      expect(await unreadFor(bob)).toBe(2);
      const items = (await listFor(bob)).body.items as Array<{
        type: string;
        is_read: boolean;
        target: { id: string };
      }>;
      expect(items.find(n => n.target.id === withAlice)!.is_read).toBe(true);
      expect(items.find(n => n.target.id === withCarol)!.is_read).toBe(false);
      expect(items.find(n => n.type === 'follow')!.is_read).toBe(false);

      // Alice reading her own copy of the thread doesn't touch bob's rows.
      await readThread(alice, withAlice);
      expect(await unreadFor(bob)).toBe(2);
    });

    it('counts unread per conversation — two threads, two rows', async () => {
      const [alice, bob, carol] = await registerUsers(3);
      const withAlice = await openWith(alice, bob);
      const withCarol = await openWith(carol, bob);

      await sendMessage(alice, withAlice, 'a');
      await sendMessage(alice, withAlice, 'b');
      await sendMessage(carol, withCarol, 'c');

      expect(messageRows((await listFor(bob)).body.items)).toHaveLength(2);
      expect(await unreadFor(bob)).toBe(2);
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
      expect(page1.body.next_cursor).toEqual(expect.any(String));
      // Newest first: the last actor followed appears first.
      expect(page1.body.items[0].actor.id).toBe(actors[2].id);

      const page2 = await api()
        .get(path(`/notifications?limit=2&cursor=${encodeURIComponent(page1.body.next_cursor)}`))
        .set('Authorization', bearer(recipient));
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].actor.id).toBe(actors[0].id);
      expect(page2.body.next_cursor).toBeNull();
    });

    it('reports and decrements the unread count', async () => {
      const [recipient, a, b] = await registerUsers(3);
      await follow(a, recipient);
      await follow(b, recipient);

      expect((await api().get(path('/notifications/unread-count')).set('Authorization', bearer(recipient))).body.data)
        .toEqual({ count: 2 });

      const marked = await api().post(path('/notifications/read')).set('Authorization', bearer(recipient)).send({});
      expect(marked.body.data).toEqual({ count: 2 });

      expect((await api().get(path('/notifications/unread-count')).set('Authorization', bearer(recipient))).body.data)
        .toEqual({ count: 0 });
    });

    it('marks only the given ids when ids are supplied', async () => {
      const [recipient, a, b] = await registerUsers(3);
      await follow(a, recipient);
      await follow(b, recipient);
      const items = (await listFor(recipient)).body.items as Array<{ id: string; is_read: boolean }>;

      const res = await api()
        .post(path('/notifications/read'))
        .set('Authorization', bearer(recipient))
        .send({ ids: [items[0]!.id] });
      expect(res.body.data).toEqual({ count: 1 });

      const after = (await listFor(recipient)).body.items as Array<{ id: string; is_read: boolean }>;
      expect(after.find(n => n.id === items[0]!.id)!.is_read).toBe(true);
      expect(after.find(n => n.id === items[1]!.id)!.is_read).toBe(false);
    });

    it('is idempotent — marking already-read rows reports 0 newly changed', async () => {
      const [recipient, a] = await registerUsers(2);
      await follow(a, recipient);
      await api().post(path('/notifications/read')).set('Authorization', bearer(recipient)).send({});
      const second = await api().post(path('/notifications/read')).set('Authorization', bearer(recipient)).send({});
      expect(second.body.data).toEqual({ count: 0 });
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
      expect(res.body.data).toEqual({ count: 0 });
      // The recipient's row is still unread.
      expect((await listFor(recipient)).body.items[0].is_read).toBe(false);
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

  // ── Realtime delivery ──────────────────────────────────────────────────────
  //
  // The half of notification delivery that had no test and was therefore dead:
  // the row was written, nothing was ever emitted. The suite has no
  // socket.io-client (it is not a dependency), so instead of faking the service
  // we boot the REAL socket layer on a throwaway server and watch the adapter —
  // the exact object `SocketManager.sendToUser` hands the packet to, one layer
  // below the wire, and the same object the Redis adapter replaces in
  // production. Nothing about the service is stubbed: the event name, the
  // `user:<id>` room and the payload are the real ones it produced.
  describe('realtime delivery', () => {
    interface BroadcastPacket {
      data?: unknown[];
    }
    interface BroadcastOpts {
      rooms: Set<string>;
    }
    interface Emit {
      event: unknown;
      payload: unknown;
      rooms: string[];
    }

    let server: http.Server;

    const watchEmits = (): Emit[] => {
      const emits: Emit[] = [];
      jest
        .spyOn(getSocketManager().getIO().of('/').adapter, 'broadcast')
        .mockImplementation((packet, opts) => {
          const data = (packet as BroadcastPacket).data ?? [];
          emits.push({
            event: data[0],
            payload: data[1],
            rooms: [...(opts as BroadcastOpts).rooms],
          });
        });
      return emits;
    };

    const notificationEmits = (emits: Emit[]): Emit[] =>
      emits.filter(e => e.event === 'notification:new');

    beforeAll(() => {
      server = http.createServer().listen(0);
      initSocketManager(server);
    });

    afterAll(async () => {
      await closeSocketManager();
    });

    it('emits notification:new to the recipient\'s room with the serialized item', async () => {
      const [alice, bob] = await registerUsers(2);
      const emits = watchEmits();

      await follow(alice, bob);

      const [emit, ...extra] = notificationEmits(emits);
      expect(extra).toEqual([]);
      expect(emit).toBeDefined();
      // Directed at the recipient, not the actor: the room every socket joins.
      expect(emit!.rooms).toEqual([`user:${bob.id}`]);

      // The payload is byte-identical to the item GET /notifications returns —
      // that identity is the contract, so the app can validate a live event with
      // its existing list schema and prepend the result to the feed unchanged.
      const listed = (await listFor(bob)).body.items as unknown[];
      expect(listed).toHaveLength(1);
      expect(emit!.payload).toEqual(listed[0]);

      // Spelled out so a drift in the serializer breaks here, not in the app.
      expect(emit!.payload).toEqual({
        id: expect.any(String),
        type: 'follow',
        actor: {
          id: alice.id,
          username: alice.username,
          display_name: alice.username,
          avatar_url: null,
          viewer: { is_self: false, is_following: false, friend_status: 'none' },
        },
        target: { type: 'user', id: alice.id },
        is_read: false,
        created_at: expect.any(String),
      });
    });

    it('emits for every notification type, each to its own recipient', async () => {
      const [alice, bob] = await registerUsers(2);
      const emits = watchEmits();

      // A friend request notifies bob; accepting it notifies alice back.
      await friendRequest(alice, bob);
      await acceptFriend(bob, alice);

      expect(
        notificationEmits(emits).map(e => ({
          rooms: e.rooms,
          type: (e.payload as { type: string }).type,
        }))
      ).toEqual([
        { rooms: [`user:${bob.id}`], type: 'friend_request' },
        { rooms: [`user:${alice.id}`], type: 'friend_accept' },
      ]);

      // A like on a video reaches its author through the same seam.
      const video_id = await postVideo(alice);
      await like(bob, video_id);
      expect(notificationEmits(emits).at(-1)).toMatchObject({
        rooms: [`user:${alice.id}`],
        payload: { type: 'like', target: { type: 'video', id: video_id } },
      });
    });

    it('emits on a COALESCED message too — same row id, full payload', async () => {
      const [alice, bob] = await registerUsers(2);
      const conversation_id = await openWith(alice, bob);
      const emits = watchEmits();

      await sendMessage(alice, conversation_id, 'one');
      await sendMessage(alice, conversation_id, 'two');

      const events = notificationEmits(emits);
      // Two events for two messages — the client must be told about the bump,
      // even though the second one UPDATED the row instead of adding one…
      expect(events).toHaveLength(2);
      expect(events.map(e => e.rooms)).toEqual([
        [`user:${bob.id}`],
        [`user:${bob.id}`],
      ]);
      const ids = events.map(e => (e.payload as { id: string }).id);
      expect(ids[0]).toBe(ids[1]);

      // …and the payload is still the whole serialized notification, identical
      // to what GET /notifications returns, so the app replaces by id.
      const listed = (await listFor(bob)).body.items as unknown[];
      expect(listed).toHaveLength(1);
      expect(events[1]!.payload).toEqual(listed[0]);
      expect(events[1]!.payload).toMatchObject({
        type: 'message',
        actor: { id: alice.id },
        target: { type: 'conversation', id: conversation_id },
        is_read: false,
      });
    });

    it('emits nothing when no row is written (self-action, duplicate like)', async () => {
      const [author, liker] = await registerUsers(2);
      const video_id = await postVideo(author);
      const emits = watchEmits();

      await like(author, video_id); // self-like → no row
      expect(notificationEmits(emits)).toEqual([]);

      await like(liker, video_id);
      expect(notificationEmits(emits)).toHaveLength(1);
      await like(liker, video_id); // already liked → no second row
      expect(notificationEmits(emits)).toHaveLength(1);
    });
  });
});
