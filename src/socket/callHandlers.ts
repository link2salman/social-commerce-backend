import type { AppServer, AppSocket } from './types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const targetOf = (payload: unknown): string | null => {
  const to = (payload as { to?: unknown })?.to;
  return typeof to === 'string' && UUID_RE.test(to) ? to : null;
};

// WebRTC call signaling relay. A caller emits call:offer/answer/ice/ended with
// `{ to: <userId>, ... }`; the server forwards it to that user's room. This is
// exactly the contract the app's callSignaling.ts already listens for:
//   - call:offer  → the callee receives { peer: <caller>, isVideo }
//   - call:ended  → the callee/caller receives { from: <userId> }
// answer/ice carry the SDP/ICE payloads verbatim for the RTCPeerConnection.
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
    emit(to, 'call:offer', {
      peer: {
        id: me.user_id,
        username: me.username,
        avatarUrl: me.avatar_url,
      },
      isVideo: Boolean((payload as { isVideo?: boolean }).isVideo),
      sdp: (payload as { sdp?: unknown }).sdp,
    });
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
