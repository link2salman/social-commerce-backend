import { api, path } from '../helpers/app';
import { bearer, registerUser, uniqueUsername, type TestUser } from '../helpers/factories';

// Call history is server state shared across a user's devices. The client runs
// the call and POSTs the record; the server owns only the id and ownership.
// Two shapes share the row (1:1 and group), enforced by a validator + a DB
// CHECK constraint — these tests pin both, and that a pre-existing 1:1 record
// keeps round-tripping unchanged.

const peerOf = (u: TestUser) => ({
  id: u.id,
  username: u.username,
  avatar_url: null as string | null,
});

const oneToOne = (peer: ReturnType<typeof peerOf>, over: Record<string, unknown> = {}) => ({
  peer,
  is_group: false,
  participants: [],
  direction: 'outgoing',
  is_video: false,
  outcome: 'completed',
  started_at: new Date(Date.now() - 60_000).toISOString(),
  duration_sec: 120,
  ...over,
});

const group = (peers: ReturnType<typeof peerOf>[], over: Record<string, unknown> = {}) => ({
  peer: null,
  is_group: true,
  participants: peers,
  direction: 'outgoing',
  is_video: true,
  outcome: 'completed',
  started_at: new Date(Date.now() - 120_000).toISOString(),
  duration_sec: 733,
  ...over,
});

describe('calls', () => {
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    owner = await registerUser();
    alice = await registerUser();
    bob = await registerUser();
  });

  describe('POST /calls (1:1)', () => {
    it('records a 1:1 call and echoes the frozen peer snapshot', async () => {
      const res = await api()
        .post(path('/calls'))
        .set('Authorization', bearer(owner))
        .send(oneToOne(peerOf(alice), { duration_sec: 312 }));

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        peer: { id: alice.id, username: alice.username, avatar_url: null },
        is_group: false,
        participants: [],
        outcome: 'completed',
        duration_sec: 312,
      });
      expect(typeof res.body.data.id).toBe('string');
    });

    it('rejects a 1:1 record that also carries participants (400)', async () => {
      const res = await api()
        .post(path('/calls'))
        .set('Authorization', bearer(owner))
        .send(oneToOne(peerOf(alice), { participants: [peerOf(bob)] }));
      expect(res.status).toBe(400);
    });

    it('rejects a 1:1 record with a null peer (400)', async () => {
      const res = await api()
        .post(path('/calls'))
        .set('Authorization', bearer(owner))
        .send(oneToOne(peerOf(alice), { peer: null }));
      expect(res.status).toBe(400);
    });
  });

  describe('POST /calls (group)', () => {
    it('records a group call with a participant roster and no single peer', async () => {
      const res = await api()
        .post(path('/calls'))
        .set('Authorization', bearer(owner))
        .send(group([peerOf(alice), peerOf(bob)]));

      expect(res.status).toBe(201);
      expect(res.body.data.peer).toBeNull();
      expect(res.body.data.is_group).toBe(true);
      expect(res.body.data.participants).toHaveLength(2);
      expect(res.body.data.participants.map((p: { id: string }) => p.id).sort()).toEqual(
        [alice.id, bob.id].sort()
      );
    });

    it('rejects a group record that names a peer (400)', async () => {
      const res = await api()
        .post(path('/calls'))
        .set('Authorization', bearer(owner))
        .send(group([peerOf(alice)], { peer: peerOf(bob) }));
      expect(res.status).toBe(400);
    });

    it('rejects a group record with an empty roster (400)', async () => {
      const res = await api()
        .post(path('/calls'))
        .set('Authorization', bearer(owner))
        .send(group([], {}));
      expect(res.status).toBe(400);
    });

    it('rejects an over-long username in a participant snapshot (400)', async () => {
      const res = await api()
        .post(path('/calls'))
        .set('Authorization', bearer(owner))
        .send(group([{ id: alice.id, username: 'x'.repeat(25), avatar_url: null }]));
      expect(res.status).toBe(400);
    });
  });

  describe('GET /calls', () => {
    it('lists both 1:1 and group records newest-first, scoped to the owner', async () => {
      const logger = await registerUser();
      await api().post(path('/calls')).set('Authorization', bearer(logger))
        .send(oneToOne(peerOf(alice), { started_at: new Date(Date.now() - 600_000).toISOString() }));
      await api().post(path('/calls')).set('Authorization', bearer(logger))
        .send(group([peerOf(alice), peerOf(bob)], { started_at: new Date(Date.now() - 60_000).toISOString() }));

      const res = await api().get(path('/calls')).set('Authorization', bearer(logger));
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      // Newest first: the group call started more recently.
      expect(res.body.items[0].is_group).toBe(true);
      expect(res.body.items[1].is_group).toBe(false);
    });

    it("never returns another user's call log", async () => {
      const mine = await registerUser();
      const stranger = await registerUser();
      await api().post(path('/calls')).set('Authorization', bearer(mine)).send(oneToOne(peerOf(alice)));

      const res = await api().get(path('/calls')).set('Authorization', bearer(stranger));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('auth', () => {
    it('rejects an unauthenticated record (401)', async () => {
      const res = await api().post(path('/calls')).send(oneToOne(peerOf(alice)));
      expect(res.status).toBe(401);
    });

    it('rejects an unauthenticated list (401)', async () => {
      const res = await api().get(path('/calls'));
      expect(res.status).toBe(401);
    });
  });

  // Guards against a regression where widening the row for groups changes the
  // 1:1 wire shape the app's Zod schema pins.
  it('a 1:1 record round-trips with the exact fields the app schema expects', async () => {
    const u = await registerUser({ username: uniqueUsername('peer') });
    const res = await api().post(path('/calls')).set('Authorization', bearer(owner))
      .send(oneToOne(peerOf(u), { direction: 'incoming', is_video: true, outcome: 'missed', duration_sec: 0 }));

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'message', 'success']);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['direction', 'duration_sec', 'id', 'is_group', 'is_video', 'outcome', 'participants', 'peer', 'started_at'].sort()
    );
  });
});
