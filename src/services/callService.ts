import CallRecord from '@models/calls/CallRecord';
import { serializeCall, type CallRecordJSON } from '@serializers/callSerializer';
import type { CallDirection, CallOutcome } from '@constants/enums';
import { optionalEnv } from '@utils/env';

// ICE servers the app feeds to its RTCPeerConnection. STUN alone lets peers on
// the same/open network connect; a TURN relay (configured via env) is needed to
// traverse symmetric NATs. Defaults to Google's public STUN so calls work in dev
// without any TURN provider.
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const splitEnv = (key: string, fallback = ''): string[] =>
  optionalEnv(key, fallback)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

export const getIceServers = (): { iceServers: IceServer[] } => {
  const iceServers: IceServer[] = [];

  const stun = splitEnv('STUN_URLS', 'stun:stun.l.google.com:19302');
  if (stun.length > 0) iceServers.push({ urls: stun });

  const turn = splitEnv('TURN_URLS');
  if (turn.length > 0) {
    iceServers.push({
      urls: turn,
      username: optionalEnv('TURN_USERNAME'),
      credential: optionalEnv('TURN_CREDENTIAL'),
    });
  }
  return { iceServers };
};

interface CallPeerInput {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export interface CallRecordInputData {
  /** The other side of a 1:1 call; null for a group. */
  peer: CallPeerInput | null;
  isGroup: boolean;
  /** Everyone rung, excluding me. Empty for a 1:1. */
  participants: CallPeerInput[];
  direction: CallDirection;
  isVideo: boolean;
  outcome: CallOutcome;
  startedAt: string;
  durationSec: number;
}

/**
 * Call history — server state (shared across a user's devices), 1:1 and group.
 *
 * Scoped to `owner_id`, which IS the ownership check: a user's log is only ever
 * reachable through their own token, so there is nothing to leak cross-user.
 * One indexed query, no join — the participant snapshots ride inline on the row
 * (see the model), which is why this read path didn't grow when groups landed.
 */
export const listCalls = async (
  ownerId: string
): Promise<{ items: CallRecordJSON[] }> => {
  const records = await CallRecord.findAll({
    where: { owner_id: ownerId },
    order: [['started_at', 'DESC']],
    limit: 100,
  });
  return { items: records.map(serializeCall) };
};

export const recordCall = async (
  ownerId: string,
  input: CallRecordInputData
): Promise<CallRecordJSON> => {
  // Freeze the roster at write time — the same reason peer_username/avatar are
  // stored inline rather than joined: this row must not drift when someone
  // later renames or changes their avatar.
  const record = await CallRecord.create({
    owner_id: ownerId,
    peer_id: input.peer?.id ?? null,
    peer_username: input.peer?.username ?? null,
    peer_avatar_url: input.peer?.avatarUrl ?? null,
    is_group: input.isGroup,
    participants: input.isGroup
      ? input.participants.map(p => ({
          id: p.id,
          username: p.username,
          avatarUrl: p.avatarUrl,
        }))
      : [],
    direction: input.direction,
    is_video: input.isVideo,
    outcome: input.outcome,
    started_at: new Date(input.startedAt),
    duration_sec: input.durationSec,
  });
  return serializeCall(record);
};
