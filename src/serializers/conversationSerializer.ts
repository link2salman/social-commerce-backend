import type { UserSummaryJSON } from '@serializers/userSerializer';
import type { GroupRole } from '@constants/enums';

// The client's conversation.schema.ts shape.
export interface ParticipantLite {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface GroupMemberJSON {
  user: UserSummaryJSON;
  role: GroupRole;
}

export interface ConversationJSON {
  id: string;
  isGroup: boolean;
  /** Group name; null for a 1:1 (the peer's name titles the thread). */
  title: string | null;
  /** The peer in a 1:1; null for a group. */
  participant: ParticipantLite | null;
  /** Everyone except me — one entry for a 1:1, N for a group. */
  participants: UserSummaryJSON[];
  /** Role-carrying full roster INCLUDING me; empty for a 1:1. */
  members: GroupMemberJSON[];
  lastMessage: string;
  lastSenderId: string;
  unreadCount: number;
  updatedAt: string;
}
