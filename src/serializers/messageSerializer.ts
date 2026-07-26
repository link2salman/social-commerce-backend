import type { MessageModel } from '@models/chat/Message';
import type { MessageStatus } from '@constants/enums';

// The client's message.schema.ts shape, snake_case on the wire. `attachment` is
// always present (nullable), matching the client's non-optional key; it is a
// pass-through of the JSONB column, which stores the same snake_case shape (see
// models/chat/Message.ts) so there is no hidden mapping between store and wire.
export interface MessageJSON {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  image_url: string | null;
  attachment: {
    type: 'product' | 'video' | 'image';
    product_id?: string;
    video_id?: string;
    url?: string;
  } | null;
  created_at: string;
  status: MessageStatus;
}

export const serializeMessage = (m: MessageModel): MessageJSON => ({
  id: m.message_id,
  conversation_id: m.conversation_id,
  sender_id: m.sender_id,
  body: m.body,
  image_url: m.image_url,
  attachment: m.attachment ?? null,
  created_at: m.created_at.toISOString(),
  status: m.status,
});
