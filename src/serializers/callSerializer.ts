import type { CallRecordModel } from '@models/calls/CallRecord';
import type { CallDirection, CallOutcome } from '@constants/enums';

// The client's call.schema.ts. `peer` is a frozen snapshot (not a live user).
export interface CallRecordJSON {
  id: string;
  peer: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
  direction: CallDirection;
  isVideo: boolean;
  outcome: CallOutcome;
  startedAt: string;
  durationSec: number;
}

export const serializeCall = (c: CallRecordModel): CallRecordJSON => ({
  id: c.call_id,
  peer: {
    id: c.peer_id,
    username: c.peer_username,
    avatarUrl: c.peer_avatar_url,
  },
  direction: c.direction,
  isVideo: c.is_video,
  outcome: c.outcome,
  startedAt: c.started_at.toISOString(),
  durationSec: c.duration_sec,
});
