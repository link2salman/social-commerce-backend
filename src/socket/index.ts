import type { Server as HTTPServer } from 'http';
import {
  closeSocketServer,
  getSocketManager,
  initSocketServer,
} from './socketServer';
import { registerChatHandlers } from './chatHandlers';
import { registerCallHandlers } from './callHandlers';

// Called once at boot (server.ts). Registers every realtime handler module.
export const initSocketManager = (server: HTTPServer): void => {
  const manager = initSocketServer(server);
  manager.use(registerChatHandlers);
  manager.use(registerCallHandlers);
};

export const closeSocketManager = async (): Promise<void> => {
  await closeSocketServer();
};

export { getSocketManager };
