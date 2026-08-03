import type { Socket as ClientSocket } from 'socket.io-client';
import { api, path } from '../helpers/app';
import { bearer, registerUser, type TestUser } from '../helpers/factories';
import {
  connectClient,
  expectNoEvent,
  nextEvent,
  startSocketServer,
  stopSocketServer,
} from '../helpers/socket';

// WebRTC call signaling over the real socket server.
//
// This file exists because there was NO socket coverage for calls at all — the
// only calls suite was HTTP-only — and that is precisely how the relay came to
// emit `isVideo`/`avatarUrl` while the app destructures `is_video` and
// `peer.avatar_url`. Nothing failed loudly: the callee read `undefined`, so a
// video call captured audio only, the avatar rendered blank, and the callee's
// history POST then 400'd because `avatar_url` is nullable, not optional.
//
// So these tests pin the WIRE CONTRACT, key by key, not just "an event
// arrived". Field names here must stay identical to the app's
// `features/calls/api/callSignaling.ts` + `store/callStore.ts`.

const SDP_OFFER = { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' };
const SDP_ANSWER = { type: 'answer', sdp: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n' };
const CANDIDATE = {
  candidate: 'candidate:1 1 udp 2130706431 192.0.2.10 54321 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0,
};

interface OfferPayload {
  peer: { id: string; username: string; avatar_url: string | null };
  is_video: boolean;
  sdp: unknown;
}

describe('call signaling (socket)', () => {
  let url: string;
  let alice: TestUser;
  let bob: TestUser;
  let aliceSocket: ClientSocket;
  let bobSocket: ClientSocket;

  beforeAll(async () => {
    url = await startSocketServer();
    alice = await registerUser();
    bob = await registerUser();
    aliceSocket = await connectClient(url, alice.access_token);
    bobSocket = await connectClient(url, bob.access_token);
  });

  afterAll(async () => {
    aliceSocket?.close();
    bobSocket?.close();
    await stopSocketServer();
  });

  describe('handshake', () => {
    it('refuses a socket with no access token', async () => {
      await expect(connectClient(url, '')).rejects.toThrow();
    });

    it('refuses a socket with a forged token', async () => {
      await expect(connectClient(url, 'not-a-jwt')).rejects.toThrow();
    });
  });

  describe('call:offer', () => {
    it('relays a video offer with snake_case fields and the caller stamped on it', async () => {
      const received = nextEvent<OfferPayload>(bobSocket, 'call:offer');
      aliceSocket.emit('call:offer', {
        to: bob.id,
        is_video: true,
        sdp: SDP_OFFER,
      });
      const payload = await received;

      // The exact contract the app destructures. `is_video` surviving the relay
      // is what decides whether the callee captures a camera track at all.
      expect(Object.keys(payload).sort()).toEqual(['is_video', 'peer', 'sdp']);
      expect(payload.is_video).toBe(true);
      expect(payload.sdp).toEqual(SDP_OFFER);
      expect(Object.keys(payload.peer).sort()).toEqual([
        'avatar_url',
        'id',
        'username',
      ]);
      expect(payload.peer).toEqual({
        id: alice.id,
        username: alice.username,
        avatar_url: null,
      });

      // Explicitly assert the camelCase spellings are gone: they were accepted
      // silently by both sides for the entire life of this feature.
      expect(payload).not.toHaveProperty('isVideo');
      expect(payload.peer).not.toHaveProperty('avatarUrl');
    });

    it('relays an audio offer as is_video: false', async () => {
      const received = nextEvent<OfferPayload>(bobSocket, 'call:offer');
      aliceSocket.emit('call:offer', {
        to: bob.id,
        is_video: false,
        sdp: SDP_OFFER,
      });
      expect((await received).is_video).toBe(false);
    });

    it('ignores an offer whose target is not a user id', async () => {
      const quiet = expectNoEvent(bobSocket, 'call:offer');
      aliceSocket.emit('call:offer', { to: 'bob', is_video: true, sdp: SDP_OFFER });
      aliceSocket.emit('call:offer', { is_video: true, sdp: SDP_OFFER });
      await quiet;
    });
  });

  describe('call:answer / call:ice / call:ended', () => {
    it('relays the answer SDP back to the caller, stamped with the answerer', async () => {
      const received = nextEvent<{ from: string; sdp: unknown }>(
        aliceSocket,
        'call:answer'
      );
      bobSocket.emit('call:answer', { to: alice.id, sdp: SDP_ANSWER });
      expect(await received).toEqual({ from: bob.id, sdp: SDP_ANSWER });
    });

    it('relays an ICE candidate verbatim', async () => {
      const received = nextEvent<{ from: string; candidate: unknown }>(
        bobSocket,
        'call:ice'
      );
      aliceSocket.emit('call:ice', { to: bob.id, candidate: CANDIDATE });
      // Verbatim matters: the app feeds this straight into RTCIceCandidate, so
      // any reshaping here would produce candidates that never pair up.
      expect(await received).toEqual({ from: alice.id, candidate: CANDIDATE });
    });

    it('relays a hang-up carrying only the sender id', async () => {
      const received = nextEvent<{ from: string }>(bobSocket, 'call:ended');
      aliceSocket.emit('call:ended', { to: bob.id });
      expect(await received).toEqual({ from: alice.id });
    });
  });

  describe('authorization', () => {
    it('refuses to ring across a block, in both directions', async () => {
      const blocker = await registerUser();
      const blocked = await registerUser();
      const blockerSocket = await connectClient(url, blocker.access_token);
      const blockedSocket = await connectClient(url, blocked.access_token);

      try {
        await api()
          .post(path(`/users/${blocked.id}/block`))
          .set('Authorization', bearer(blocker))
          .expect(200);

        // The blocked user cannot ring the blocker...
        const blockerQuiet = expectNoEvent(blockerSocket, 'call:offer');
        blockedSocket.emit('call:offer', {
          to: blocker.id,
          is_video: false,
          sdp: SDP_OFFER,
        });
        await blockerQuiet;

        // ...and the blocker cannot ring them either.
        const blockedQuiet = expectNoEvent(blockedSocket, 'call:offer');
        blockerSocket.emit('call:offer', {
          to: blocked.id,
          is_video: false,
          sdp: SDP_OFFER,
        });
        await blockedQuiet;
      } finally {
        blockerSocket.close();
        blockedSocket.close();
      }
    });

    it('still rings a user with no block between them', async () => {
      const received = nextEvent<OfferPayload>(bobSocket, 'call:offer');
      aliceSocket.emit('call:offer', {
        to: bob.id,
        is_video: true,
        sdp: SDP_OFFER,
      });
      expect((await received).peer.id).toBe(alice.id);
    });
  });
});
