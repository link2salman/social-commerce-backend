import { Op } from 'sequelize';
import Block from '@models/social/Block';
import logger from '@utils/logger';
import type { AppServer, AppSocket } from './types';
import { sendToUser } from '@services/pushService';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const targetOf = (payload: unknown): string | null => {
  const to = (payload as { to?: unknown })?.to;
  return typeof to === 'string' && UUID_RE.test(to) ? to : null;
};

// A block severs calling in BOTH directions: the blocker must not be rung, and
// must not be able to ring. Read straight off the model here for the same
// reason chatHandlers reads ConversationMember directly — a socket handler's
// authorization check is a single indexed lookup, not business logic.
const blockedBetween = async (a: string, b: string): Promise<boolean> => {
  const row = await Block.findOne({
    where: {
      [Op.or]: [
        { blocker_id: a, blocked_id: b },
        { blocker_id: b, blocked_id: a },
      ],
    },
    attributes: ['block_id'],
  });
  return row !== null;
};

// WebRTC call signaling relay. A caller emits call:offer/answer/ice/ended with
// `{ to: <userId>, ... }`; the server forwards it to that user's room. This is
// exactly the contract the app's callSignaling.ts already listens for:
//   - call:offer  → the callee receives { peer: <caller>, is_video, sdp }
//   - call:ended  → the callee/caller receives { from: <userId> }
// answer/ice carry the SDP/ICE payloads verbatim for the RTCPeerConnection.
//
// Every field on the wire is snake_case, like the rest of this API — the app
// destructures `is_video` and `peer.avatar_url` and validates the history POST
// against the same names. Emitting `isVideo`/`avatarUrl` here (as this handler
// used to) did not fail loudly: the callee just read `undefined`, captured
// audio only on a video call, rendered a blank avatar, and then 400'd on
// POST /calls because `avatar_url` is nullable, not optional.
export const registerCallHandlers = (io: AppServer, socket: AppSocket): void => {
  const me = socket.data;
  const emit = (to: string, event: string, data: unknown): void => {
    io.to(`user:${to}`).emit(event, data);
  };

  // Caller → callee. The server stamps the caller's identity so the callee's
  // incoming-call UI can render it (peer = the caller). Works for 1:1 and for
  // group calls (the client rings each participant with a separate offer).
  socket.on('call:offer', (payload: unknown) => {
    const to = targetOf(payload);
    if (!to) return;
    const is_video = Boolean((payload as { is_video?: boolean }).is_video);
    const sdp = (payload as { sdp?: unknown }).sdp;

    // Relaying is async because the block check is a DB read; the push fallback
    // rides in the same chain. An unguarded async IIFE here would make any
    // rejection (a DB blip in fetchSockets or the token lookup) an unhandled
    // rejection, which Node 20 turns into a process exit — killing every other
    // live call on this instance.
    void (async () => {
      if (await blockedBetween(me.user_id, to)) return;

      emit(to, 'call:offer', {
        peer: {
          id: me.user_id,
          username: me.username,
          avatar_url: me.avatar_url,
        },
        is_video,
        sdp,
      });

      // If the callee has no socket connected, the room emit reached no one —
      // wake them with a push so the call can still ring. Best-effort.
      const online = (await io.in(`user:${to}`).fetchSockets()).length > 0;
      if (!online) {
        await sendToUser(to, {
          title: `${is_video ? 'Video' : 'Voice'} call`,
          body: `${me.username} is calling you`,
          data: {
            type: 'call',
            caller_id: me.user_id,
            is_video: String(is_video),
          },
        });
      }
    })().catch(err =>
      logger.error({ err, from: me.user_id, to }, 'call: offer relay failed')
    );
  });

  socket.on('call:answer', (payload: unknown) => {
    const to = targetOf(payload);
    if (!to) return;
    emit(to, 'call:answer', {
      from: me.user_id,
      sdp: (payload as { sdp?: unknown }).sdp,
    });
  });

  socket.on('call:ice', (payload: unknown) => {
    const to = targetOf(payload);
    if (!to) return;
    emit(to, 'call:ice', {
      from: me.user_id,
      candidate: (payload as { candidate?: unknown }).candidate,
    });
  });

  socket.on('call:ended', (payload: unknown) => {
    const to = targetOf(payload);
    if (!to) return;
    emit(to, 'call:ended', { from: me.user_id });
  });
};
