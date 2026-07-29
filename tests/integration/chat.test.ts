import { api, path } from '../helpers/app';
import { registerUsers, bearer, type TestUser } from '../helpers/factories';
import ConversationMember from '@models/chat/ConversationMember';
import Conversation from '@models/chat/Conversation';

const openWith = (viewer: TestUser, peerId: string) =>
  api().post(path(`/conversations/with/${peerId}`)).set('Authorization', bearer(viewer));

const createGroup = (owner: TestUser, title: string, participant_ids: string[]) =>
  api()
    .post(path('/conversations/group'))
    .set('Authorization', bearer(owner))
    .send({ title, participant_ids });

const roleOf = async (conversation_id: string, user_id: string): Promise<string | null> => {
  const row = await ConversationMember.findOne({
    where: { conversation_id: conversation_id, user_id: user_id },
  });
  return row?.role ?? null;
};

describe('chat', () => {
  describe('1:1 conversations', () => {
    it('creates a thread on first open and REUSES it on the second', async () => {
      const [alice, bob] = await registerUsers(2);

      const created = await openWith(alice, bob.id);
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        id: expect.any(String),
        is_group: false,
        title: null,
        // The peer titles a 1:1 thread; `members` (role roster) is group-only.
        participant: {
          id: bob.id,
          username: bob.username,
          display_name: bob.username,
          avatar_url: null,
        },
        members: [],
        unread_count: 0,
      });
      expect(created.body.data.participants).toHaveLength(1);
      expect(created.body.data.participants[0].id).toBe(bob.id);

      // 200 (not 201) the second time — same conversation, no duplicate.
      const reopened = await openWith(alice, bob.id);
      expect(reopened.status).toBe(200);
      expect(reopened.body.data.id).toBe(created.body.data.id);

      // …including when the OTHER side opens it.
      const fromBob = await openWith(bob, alice.id);
      expect(fromBob.status).toBe(200);
      expect(fromBob.body.data.id).toBe(created.body.data.id);
      expect(fromBob.body.data.participant.id).toBe(alice.id);

      expect(await Conversation.count()).toBe(1);
    });

    it('refuses a conversation with yourself', async () => {
      const [alice] = await registerUsers(1);
      const res = await openWith(alice, alice.id);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Cannot message yourself');
    });

    it('404s opening a thread with a user that does not exist', async () => {
      const [alice] = await registerUsers(1);
      const res = await openWith(alice, '00000000-0000-4000-8000-000000000000');

      expect(res.status).toBe(404);
    });
  });

  describe('messages', () => {
    it('posts a message, returns the Message shape, and updates the inbox', async () => {
      const [alice, bob] = await registerUsers(2);
      const conv = await openWith(alice, bob.id);
      const convId = conv.body.data.id;

      const sent = await api()
        .post(path(`/conversations/${convId}/messages`))
        .set('Authorization', bearer(alice))
        .send({ body: 'Hello there' });

      expect(sent.status).toBe(201);
      expect(sent.body.data).toEqual({
        id: expect.any(String),
        conversation_id: convId,
        sender_id: alice.id,
        body: 'Hello there',
        image_url: null,
        attachment: null, // always present, nullable — the client key is required
        created_at: expect.any(String),
        status: 'sent',
      });

      // The denormalized inbox preview was updated for the recipient…
      const bobInbox = await api()
        .get(path('/conversations'))
        .set('Authorization', bearer(bob));
      expect(bobInbox.status).toBe(200);
      expect(bobInbox.body.items).toHaveLength(1);
      expect(bobInbox.body.items[0]).toMatchObject({
        id: convId,
        last_message: 'Hello there',
        last_sender_id: alice.id,
        unread_count: 1,
      });

      // …and not counted as unread for the sender.
      const aliceInbox = await api()
        .get(path('/conversations'))
        .set('Authorization', bearer(alice));
      expect(aliceInbox.body.items[0].unread_count).toBe(0);
    });

    it('reading the thread clears unread and marks the peer\'s messages read', async () => {
      const [alice, bob] = await registerUsers(2);
      const conv = await openWith(alice, bob.id);
      const convId = conv.body.data.id;

      await api()
        .post(path(`/conversations/${convId}/messages`))
        .set('Authorization', bearer(alice))
        .send({ body: 'ping' });

      const read = await api()
        .get(path(`/conversations/${convId}/messages`))
        .set('Authorization', bearer(bob));

      expect(read.status).toBe(200);
      expect(Object.keys(read.body).sort()).toEqual(["items", "message", "success", "typing"]);
      // Typing is a socket-only signal; the HTTP snapshot is never typing.
      expect(read.body.typing).toBe(false);
      expect(read.body.items).toHaveLength(1);
      expect(read.body.items[0].status).toBe('read');

      const inbox = await api().get(path('/conversations')).set('Authorization', bearer(bob));
      expect(inbox.body.items[0].unread_count).toBe(0);
    });

    it('returns messages oldest-first', async () => {
      const [alice, bob] = await registerUsers(2);
      const convId = (await openWith(alice, bob.id)).body.data.id;

      for (const body of ['first', 'second', 'third']) {
        const res = await api()
          .post(path(`/conversations/${convId}/messages`))
          .set('Authorization', bearer(alice))
          .send({ body });
        expect(res.status).toBe(201);
      }

      const read = await api()
        .get(path(`/conversations/${convId}/messages`))
        .set('Authorization', bearer(bob));
      expect(read.body.items.map((m: { body: string }) => m.body)).toEqual([
        'first',
        'second',
        'third',
      ]);
    });

    it('accepts an image-only message', async () => {
      const [alice, bob] = await registerUsers(2);
      const convId = (await openWith(alice, bob.id)).body.data.id;

      const res = await api()
        .post(path(`/conversations/${convId}/messages`))
        .set('Authorization', bearer(alice))
        .send({ image_url: 'https://cdn.example.test/photo.jpg' });

      expect(res.status).toBe(201);
      expect(res.body.data.body).toBe('');
      expect(res.body.data.image_url).toBe('https://cdn.example.test/photo.jpg');

      const inbox = await api().get(path('/conversations')).set('Authorization', bearer(bob));
      expect(inbox.body.items[0].last_message).toBe('📷 Photo');
    });

    it('400s on a message with neither text nor image', async () => {
      const [alice, bob] = await registerUsers(2);
      const convId = (await openWith(alice, bob.id)).body.data.id;

      const res = await api()
        .post(path(`/conversations/${convId}/messages`))
        .set('Authorization', bearer(alice))
        .send({ body: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
    });

    it('403s a non-member trying to read or post', async () => {
      const [alice, bob, stranger] = await registerUsers(3);
      const convId = (await openWith(alice, bob.id)).body.data.id;

      const read = await api()
        .get(path(`/conversations/${convId}/messages`))
        .set('Authorization', bearer(stranger));
      expect(read.status).toBe(403);
      expect(read.body.message).toMatch(/not a member/i);

      const post = await api()
        .post(path(`/conversations/${convId}/messages`))
        .set('Authorization', bearer(stranger))
        .send({ body: 'let me in' });
      expect(post.status).toBe(403);
    });
  });

  describe('groups', () => {
    it('creates a group with the caller as owner and everyone else as member', async () => {
      const [owner, a, b] = await registerUsers(3);

      const res = await createGroup(owner, 'Weekend Trip', [a.id, b.id]);

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        is_group: true,
        title: 'Weekend Trip',
        participant: null, // group threads have no single peer
      });
      // `members` carries the role-bearing roster INCLUDING me, owner first.
      expect(res.body.data.members).toHaveLength(3);
      expect(res.body.data.members[0]).toEqual({
        user: expect.objectContaining({ id: owner.id }),
        role: 'owner',
      });
      expect(
        res.body.data.members.slice(1).every((m: { role: string }) => m.role === 'member')
      ).toBe(true);
      // `participants` is everyone EXCEPT me.
      expect(res.body.data.participants).toHaveLength(2);
      expect(res.body.data.participants.map((p: { id: string }) => p.id).sort()).toEqual(
        [a.id, b.id].sort()
      );
    });

    it('400s a group with fewer than two other members', async () => {
      const [owner, a] = await registerUsers(2);
      const res = await createGroup(owner, 'Too Small', [a.id]);

      expect(res.status).toBe(400);
    });

    it('400s when the participant list is only the caller', async () => {
      const [owner, a] = await registerUsers(2);
      // The caller is filtered out of participant_ids, leaving one real member.
      const res = await createGroup(owner, 'Just Me', [owner.id, a.id]);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least two other members/i);
    });

    it('404s when a participant does not exist', async () => {
      const [owner, a] = await registerUsers(2);
      const res = await createGroup(owner, 'Ghosts', [
        a.id,
        '00000000-0000-4000-8000-000000000000',
      ]);

      expect(res.status).toBe(404);
    });

    it('400s on a blank title', async () => {
      const [owner, a, b] = await registerUsers(3);
      const res = await createGroup(owner, '   ', [a.id, b.id]);

      expect(res.status).toBe(400);
    });
  });

  describe('group member management (role gating)', () => {
    it('lets the owner add members', async () => {
      const [owner, a, b, newcomer] = await registerUsers(4);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const res = await api()
        .post(path(`/conversations/${convId}/members`))
        .set('Authorization', bearer(owner))
        .send({ user_ids: [newcomer.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.members).toHaveLength(4);
      expect(await roleOf(convId, newcomer.id)).toBe('member');
    });

    it('is idempotent when adding an existing member', async () => {
      const [owner, a, b] = await registerUsers(3);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const res = await api()
        .post(path(`/conversations/${convId}/members`))
        .set('Authorization', bearer(owner))
        .send({ user_ids: [a.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.members).toHaveLength(3);
    });

    it('FORBIDS a plain member from adding members', async () => {
      const [owner, a, b, newcomer] = await registerUsers(4);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const res = await api()
        .post(path(`/conversations/${convId}/members`))
        .set('Authorization', bearer(a))
        .send({ user_ids: [newcomer.id] });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/do not have permission/i);
      expect(await roleOf(convId, newcomer.id)).toBeNull();
    });

    it('lets the owner PROMOTE a member to admin, who can then add members', async () => {
      const [owner, a, b, newcomer] = await registerUsers(4);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const promoted = await api()
        .patch(path(`/conversations/${convId}/members/${a.id}`))
        .set('Authorization', bearer(owner))
        .send({ role: 'admin' });

      expect(promoted.status).toBe(200);
      expect(await roleOf(convId, a.id)).toBe('admin');

      // The new admin now passes the owner|admin gate.
      const added = await api()
        .post(path(`/conversations/${convId}/members`))
        .set('Authorization', bearer(a))
        .send({ user_ids: [newcomer.id] });
      expect(added.status).toBe(200);
    });

    it('FORBIDS an admin from changing roles (owner only)', async () => {
      const [owner, a, b] = await registerUsers(3);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;
      await api()
        .patch(path(`/conversations/${convId}/members/${a.id}`))
        .set('Authorization', bearer(owner))
        .send({ role: 'admin' });

      const res = await api()
        .patch(path(`/conversations/${convId}/members/${b.id}`))
        .set('Authorization', bearer(a))
        .send({ role: 'admin' });

      expect(res.status).toBe(403);
      expect(await roleOf(convId, b.id)).toBe('member');
    });

    it('FORBIDS transferring ownership and FORBIDS demoting the owner', async () => {
      const [owner, a, b] = await registerUsers(3);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const transfer = await api()
        .patch(path(`/conversations/${convId}/members/${a.id}`))
        .set('Authorization', bearer(owner))
        .send({ role: 'owner' });
      expect(transfer.status).toBe(403);
      expect(transfer.body.message).toMatch(/ownership transfer is not supported/i);

      const demote = await api()
        .patch(path(`/conversations/${convId}/members/${owner.id}`))
        .set('Authorization', bearer(owner))
        .send({ role: 'member' });
      expect(demote.status).toBe(403);
      expect(demote.body.message).toMatch(/owner's role cannot be changed/i);
      expect(await roleOf(convId, owner.id)).toBe('owner');
    });

    it('400s on an unknown role value', async () => {
      const [owner, a, b] = await registerUsers(3);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const res = await api()
        .patch(path(`/conversations/${convId}/members/${a.id}`))
        .set('Authorization', bearer(owner))
        .send({ role: 'superuser' });

      expect(res.status).toBe(400);
    });

    it('lets the owner remove a member but NOT the owner themselves', async () => {
      const [owner, a, b] = await registerUsers(3);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const removed = await api()
        .delete(path(`/conversations/${convId}/members/${a.id}`))
        .set('Authorization', bearer(owner));
      expect(removed.status).toBe(200);
      expect(removed.body.data.members).toHaveLength(2);
      expect(await roleOf(convId, a.id)).toBeNull();

      const self = await api()
        .delete(path(`/conversations/${convId}/members/${owner.id}`))
        .set('Authorization', bearer(owner));
      expect(self.status).toBe(403);
      expect(self.body.message).toMatch(/owner cannot be removed/i);
    });

    it('FORBIDS an admin from removing another admin', async () => {
      const [owner, a, b] = await registerUsers(3);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;
      for (const user of [a, b]) {
        await api()
          .patch(path(`/conversations/${convId}/members/${user.id}`))
          .set('Authorization', bearer(owner))
          .send({ role: 'admin' });
      }

      const res = await api()
        .delete(path(`/conversations/${convId}/members/${b.id}`))
        .set('Authorization', bearer(a));

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/admins cannot remove other admins/i);
      expect(await roleOf(convId, b.id)).toBe('admin');
    });

    it('FORBIDS a plain member from removing anyone', async () => {
      const [owner, a, b] = await registerUsers(3);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const res = await api()
        .delete(path(`/conversations/${convId}/members/${b.id}`))
        .set('Authorization', bearer(a));

      expect(res.status).toBe(403);
      expect(await roleOf(convId, b.id)).toBe('member');
    });

    it('404s removing someone who is not in the group', async () => {
      const [owner, a, b, stranger] = await registerUsers(4);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const res = await api()
        .delete(path(`/conversations/${convId}/members/${stranger.id}`))
        .set('Authorization', bearer(owner));

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Member not found');
    });

    it('400s member management on a 1:1 conversation', async () => {
      const [alice, bob, c] = await registerUsers(3);
      const convId = (await openWith(alice, bob.id)).body.data.id;

      const res = await api()
        .post(path(`/conversations/${convId}/members`))
        .set('Authorization', bearer(alice))
        .send({ user_ids: [c.id] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Not a group conversation');
    });
  });

  describe('DELETE /conversations/:id/members/me (leave)', () => {
    it('lets a member leave — the thread drops off their inbox only', async () => {
      const [owner, a, b] = await registerUsers(3);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const left = await api()
        .delete(path(`/conversations/${convId}/members/me`))
        .set('Authorization', bearer(a));

      // Leaving acknowledges with the envelope only, not the conversation.
      expect(left.status).toBe(200);
      expect(left.body.success).toBe(true);
      expect(await roleOf(convId, a.id)).toBeNull();

      const theirInbox = await api()
        .get(path('/conversations'))
        .set('Authorization', bearer(a));
      expect(theirInbox.body.items).toHaveLength(0);

      const ownerInbox = await api()
        .get(path('/conversations'))
        .set('Authorization', bearer(owner));
      expect(ownerInbox.body.items).toHaveLength(1);
      expect(ownerInbox.body.items[0].members).toHaveLength(2);

      // …and they can no longer read it.
      const read = await api()
        .get(path(`/conversations/${convId}/messages`))
        .set('Authorization', bearer(a));
      expect(read.status).toBe(403);
    });

    it('hands ownership to the most senior remaining member when the OWNER leaves', async () => {
      const [owner, a, b] = await registerUsers(3);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;
      // Make `b` an admin so they outrank plain-member `a` in the succession.
      await api()
        .patch(path(`/conversations/${convId}/members/${b.id}`))
        .set('Authorization', bearer(owner))
        .send({ role: 'admin' });

      const left = await api()
        .delete(path(`/conversations/${convId}/members/me`))
        .set('Authorization', bearer(owner));

      expect(left.status).toBe(200);
      expect(await roleOf(convId, owner.id)).toBeNull();
      // The group survives with a new owner rather than being deleted.
      expect(await roleOf(convId, b.id)).toBe('owner');
      expect(await roleOf(convId, a.id)).toBe('member');
      expect(await Conversation.findByPk(convId)).not.toBeNull();
    });

    it('deletes the thread when the LAST member leaves', async () => {
      const [alice, bob] = await registerUsers(2);
      const convId = (await openWith(alice, bob.id)).body.data.id;

      await api()
        .delete(path(`/conversations/${convId}/members/me`))
        .set('Authorization', bearer(alice));
      expect(await Conversation.findByPk(convId)).not.toBeNull();

      await api()
        .delete(path(`/conversations/${convId}/members/me`))
        .set('Authorization', bearer(bob));
      expect(await Conversation.findByPk(convId)).toBeNull();
    });

    it('403s a non-member trying to leave', async () => {
      const [owner, a, b, stranger] = await registerUsers(4);
      const convId = (await createGroup(owner, 'Crew', [a.id, b.id])).body.data.id;

      const res = await api()
        .delete(path(`/conversations/${convId}/members/me`))
        .set('Authorization', bearer(stranger));

      expect(res.status).toBe(403);
    });
  });

  describe('GET /conversations', () => {
    it('returns only the caller\'s threads, most-recent first', async () => {
      const [alice, bob, carol] = await registerUsers(3);
      const withBob = (await openWith(alice, bob.id)).body.data.id;
      const withCarol = (await openWith(alice, carol.id)).body.data.id;

      // Make the Bob thread the most recently active.
      await api()
        .post(path(`/conversations/${withBob}/messages`))
        .set('Authorization', bearer(alice))
        .send({ body: 'latest' });

      const res = await api().get(path('/conversations')).set('Authorization', bearer(alice));

      expect(res.status).toBe(200);
      expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([withBob, withCarol]);

      // Carol sees only her own thread.
      const carolInbox = await api()
        .get(path('/conversations'))
        .set('Authorization', bearer(carol));
      expect(carolInbox.body.items.map((c: { id: string }) => c.id)).toEqual([withCarol]);
    });

    it('requires auth', async () => {
      const res = await api().get(path('/conversations'));
      expect(res.status).toBe(401);
    });
  });
});
