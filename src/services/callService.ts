import CallRecord from '@models/calls/CallRecord';
import { serializeCall, type CallRecordJSON } from '@serializers/callSerializer';
import type { CallDirection, CallOutcome } from '@constants/enums';

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
