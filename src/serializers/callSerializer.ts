import type { CallRecordModel } from '@models/calls/CallRecord';
import type { CallDirection, CallOutcome } from '@constants/enums';

// The client's call.schema.ts, snake_case on the wire. Every person named here
// is a frozen snapshot (not a live user), so a history row never drifts if
// someone later renames. The `participants` JSONB column stores this same
// snake_case shape (see models/calls/CallRecord.ts), so the group branch below
// is a pass-through rather than a remap.
export interface CallPeerJSON {
  id: string;
  username: string;
  avatar_url: string | null;
}

/**
 * Mirrors the app's `CallRecordSchema`. `peer` / `participants` are mutually
 * exclusive and follow the same convention the chat contract already uses for
 * threads (`ConversationSchema`: `participant` null for groups, `members` []
 * for a 1:1):
 *
 *   is_group false → `peer` set,  `participants` []
 *   is_group true  → `peer` null, `participants` non-empty
 */
export interface CallRecordJSON {
  id: string;
  peer: CallPeerJSON | null;
  is_group: boolean;
  participants: CallPeerJSON[];
  direction: CallDirection;
  is_video: boolean;
  outcome: CallOutcome;
  started_at: string;
  duration_sec: number;
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
          avatar_url: c.peer_avatar_url,
        },
  is_group: c.is_group,
  participants: c.is_group ? c.participants : [],
  direction: c.direction,
  is_video: c.is_video,
  outcome: c.outcome,
  started_at: c.started_at.toISOString(),
  duration_sec: c.duration_sec,
});
