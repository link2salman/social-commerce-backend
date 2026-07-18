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

export interface CallRecordInputData {
  peer: { id: string; username: string; avatarUrl: string | null };
  direction: CallDirection;
  isVideo: boolean;
  outcome: CallOutcome;
  startedAt: string;
  durationSec: number;
}

// Call history — server state (shared across a user's devices). 1:1 only;
// group-call records are a room concern the client doesn't post.
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
  const record = await CallRecord.create({
    owner_id: ownerId,
    peer_id: input.peer.id,
    peer_username: input.peer.username,
    peer_avatar_url: input.peer.avatarUrl,
    direction: input.direction,
    is_video: input.isVideo,
    outcome: input.outcome,
    started_at: new Date(input.startedAt),
    duration_sec: input.durationSec,
  });
  return serializeCall(record);
};
