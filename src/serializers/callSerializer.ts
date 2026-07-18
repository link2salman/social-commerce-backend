import type { CallRecordModel } from '@models/calls/CallRecord';
import type { CallDirection, CallOutcome } from '@constants/enums';

// The client's call.schema.ts. Every person named here is a frozen snapshot
// (not a live user), so a history row never drifts if someone later renames.
export interface CallPeerJSON {
  id: string;
  username: string;
  avatarUrl: string | null;
}

/**
 * Mirrors the app's `CallRecordSchema`. `peer` / `participants` are mutually
 * exclusive and follow the same convention the chat contract already uses for
 * threads (`ConversationSchema`: `participant` null for groups, `members` []
 * for a 1:1):
 *
 *   isGroup false → `peer` set,  `participants` []
 *   isGroup true  → `peer` null, `participants` non-empty
 */
export interface CallRecordJSON {
  id: string;
  peer: CallPeerJSON | null;
  isGroup: boolean;
  participants: CallPeerJSON[];
  direction: CallDirection;
  isVideo: boolean;
  outcome: CallOutcome;
  startedAt: string;
  durationSec: number;
}

export const serializeCall = (c: CallRecordModel): CallRecordJSON => ({
  id: c.call_id,
  // A pre-existing 1:1 row is unaffected: is_group defaults to false, so it
  // still serializes its peer_* snapshot exactly as before.
  peer:
    c.is_group || c.peer_id === null || c.peer_username === null
      ? null
      : {
          id: c.peer_id,
          username: c.peer_username,
          avatarUrl: c.peer_avatar_url,
        },
  isGroup: c.is_group,
  participants: c.is_group ? c.participants : [],
  direction: c.direction,
  isVideo: c.is_video,
  outcome: c.outcome,
  startedAt: c.started_at.toISOString(),
  durationSec: c.duration_sec,
});
