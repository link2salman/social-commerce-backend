import { createHmac } from 'crypto';
import { api, path } from '../helpers/app';
import { bearer, registerUser, uniqueUsername, type TestUser } from '../helpers/factories';
import { __resetTurnConfigLog } from '@services/callService';

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

  // The RTCPeerConnection is only as good as this list. A TURN relay is what
  // makes a call work between two phones on mobile data (symmetric NAT/CGNAT),
  // and a half-configured one is worse than none — empty credentials
  // authenticate AS empty strings, so every allocation is refused while the
  // config looks complete. These pin both branches.
  describe('GET /calls/ice-servers', () => {
    const TURN_KEYS = [
      'TURN_URLS',
      'TURN_USERNAME',
      'TURN_CREDENTIAL',
      'TURN_STATIC_AUTH_SECRET',
      'TURN_CREDENTIAL_TTL_SECONDS',
    ] as const;
    const saved = new Map(TURN_KEYS.map(k => [k, process.env[k]]));

    type TurnEntry = { urls: string[]; username?: string; credential?: string };
    const iceServers = async (user: TestUser): Promise<TurnEntry[]> => {
      const res = await api()
        .get(path('/calls/ice-servers'))
        .set('Authorization', bearer(user));
      expect(res.status).toBe(200);
      return res.body.data.ice_servers as TurnEntry[];
    };

    afterEach(() => {
      for (const key of TURN_KEYS) {
        const value = saved.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      __resetTurnConfigLog();
    });

    it('serves STUN with no TURN configured', async () => {
      delete process.env.TURN_URLS;
      const servers = await iceServers(owner);

      expect(servers).toHaveLength(1);
      expect(servers[0]!.urls[0]).toMatch(/^stun:/);
    });

    it('serves a fully-credentialed TURN relay alongside STUN', async () => {
      process.env.TURN_URLS = 'turn:turn.example.test:3478';
      process.env.TURN_USERNAME = 'relay-user';
      process.env.TURN_CREDENTIAL = 'relay-secret';

      const servers = await iceServers(owner);

      expect(servers).toHaveLength(2);
      expect(servers[1]).toEqual({
        urls: ['turn:turn.example.test:3478'],
        username: 'relay-user',
        credential: 'relay-secret',
      });
    });

    it('omits a TURN relay whose credentials are missing', async () => {
      process.env.TURN_URLS = 'turn:turn.example.test:3478';
      delete process.env.TURN_USERNAME;
      delete process.env.TURN_CREDENTIAL;
      delete process.env.TURN_STATIC_AUTH_SECRET;

      const servers = await iceServers(owner);

      expect(servers).toHaveLength(1);
      expect(servers[0]!.urls[0]).toMatch(/^stun:/);
      // Not just "no TURN entry": nothing half-configured may leak either. A
      // relay URL with no credential is an entry the client will dial and be
      // refused by, which looks like a broken relay rather than an absent one.
      expect(servers.some(s => s.username !== undefined || s.credential !== undefined)).toBe(false);
      expect(JSON.stringify(servers)).not.toContain('turn:');
    });

    it('rejects an unauthenticated request (401)', async () => {
      const res = await api().get(path('/calls/ice-servers'));
      expect(res.status).toBe(401);
    });

    // coturn `use-auth-secret`: the credential is computed, never stored, so
    // these tests recompute the HMAC independently rather than calling the
    // service's own helper — the point is to pin the wire format coturn will
    // verify against, not that the function agrees with itself.
    describe('with a static-auth-secret (time-limited REST credentials)', () => {
      const SECRET = 'test-static-auth-secret';
      const expected = (username: string): string =>
        createHmac('sha1', SECRET).update(username).digest('base64');

      beforeEach(() => {
        process.env.TURN_URLS = 'turn:turn.example.test:3478?transport=udp';
        process.env.TURN_STATIC_AUTH_SECRET = SECRET;
        delete process.env.TURN_USERNAME;
        delete process.env.TURN_CREDENTIAL;
      });

      it('mints <expiry>:<userId> with a future expiry and a matching HMAC', async () => {
        delete process.env.TURN_CREDENTIAL_TTL_SECONDS; // default 12h
        const before = Math.floor(Date.now() / 1000);

        const servers = await iceServers(owner);
        expect(servers).toHaveLength(2);

        const relay = servers[1]!;
        expect(relay.urls).toEqual(['turn:turn.example.test:3478?transport=udp']);

        const [expiry, ...rest] = relay.username!.split(':');
        // The user id is a UUID and contains no ':', but split/rejoin is what
        // coturn does (first field is the timestamp), so mirror it.
        expect(rest.join(':')).toBe(owner.id);
        expect(Number(expiry)).toBeGreaterThan(before);
        // 12h ± the time this request took.
        expect(Number(expiry)).toBeGreaterThanOrEqual(before + 12 * 3600);
        expect(Number(expiry)).toBeLessThanOrEqual(before + 12 * 3600 + 60);

        expect(relay.credential).toBe(expected(relay.username!));
      });

      it('honours TURN_CREDENTIAL_TTL_SECONDS', async () => {
        process.env.TURN_CREDENTIAL_TTL_SECONDS = '600';
        const before = Math.floor(Date.now() / 1000);

        const relay = (await iceServers(owner))[1]!;
        const expiry = Number(relay.username!.split(':')[0]);

        expect(expiry).toBeGreaterThanOrEqual(before + 600);
        expect(expiry).toBeLessThanOrEqual(before + 660);
        expect(relay.credential).toBe(expected(relay.username!));
      });

      it('scopes the credential per user', async () => {
        const mine = (await iceServers(alice))[1]!;
        const theirs = (await iceServers(bob))[1]!;

        expect(mine.username).toContain(`:${alice.id}`);
        expect(theirs.username).toContain(`:${bob.id}`);
        expect(mine.username).not.toBe(theirs.username);
        // Different username ⇒ different HMAC. If these ever matched, the
        // credential would not be scoped to anyone and per-user quotas would be
        // meaningless.
        expect(mine.credential).not.toBe(theirs.credential);
        expect(mine.credential).toBe(expected(mine.username!));
        expect(theirs.credential).toBe(expected(theirs.username!));
      });

      it('never sends the shared secret itself to the client', async () => {
        const servers = await iceServers(owner);
        expect(JSON.stringify(servers)).not.toContain(SECRET);
      });

      it('prefers the minted credential over a static username/credential pair', async () => {
        process.env.TURN_USERNAME = 'relay-user';
        process.env.TURN_CREDENTIAL = 'relay-secret';

        const relay = (await iceServers(owner))[1]!;

        expect(relay.username).not.toBe('relay-user');
        expect(relay.credential).toBe(expected(relay.username!));
      });

      it('falls back to STUN-only when the secret is blank, with no partial relay', async () => {
        process.env.TURN_STATIC_AUTH_SECRET = '';

        const servers = await iceServers(owner);

        expect(servers).toHaveLength(1);
        expect(servers[0]!.urls[0]).toMatch(/^stun:/);
        expect(JSON.stringify(servers)).not.toContain('turn:');
      });
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
