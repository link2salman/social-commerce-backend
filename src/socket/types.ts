import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { DefaultEventsMap } from 'socket.io/dist/typed-events';

// Every authenticated socket carries this on `socket.data`. Parameterising the
// server/socket types with it means handlers read `socket.data.user_id` with no
// cast, and it rides along with io.fetchSockets() (adapter-federated presence).
export interface SocketUser {
  user_id: string;
  username: string;
  avatar_url: string | null;
  socket_id: string;
  token: string;
  token_exp?: number;
  session_id?: string;
  /** Conversation rooms this socket has joined (authorization for broadcasts). */
  joinedConversations: Set<string>;
}

export type AppServer = SocketIOServer<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketUser
>;

export type AppSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketUser
>;
