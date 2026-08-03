import http from 'http';
import type { AddressInfo } from 'net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { initSocketManager, closeSocketManager } from '../../src/socket';

// Realtime fixtures.
//
// The HTTP suite drives Express through supertest, which never boots the socket
// layer — which is exactly why the call-signaling payload contract could drift
// (isVideo/avatarUrl vs is_video/avatar_url) with 288 green tests. These helpers
// boot the REAL socket server (same auth middleware, same handler registration
// as server.ts) on an ephemeral port and connect real socket.io clients to it.
//
// One listener per test file, same reasoning as helpers/app.ts.

let server: http.Server | undefined;

/** Boot the socket server once per test file; returns its base URL. */
export const startSocketServer = async (): Promise<string> => {
  if (!server) {
    // A bare HTTP server: socket.io attaches its own upgrade/polling handlers,
    // and no test here makes a plain HTTP request to this port (those go
    // through helpers/app.ts).
    const created = http.createServer();
    initSocketManager(created);
    await new Promise<void>(resolve => created.listen(0, resolve));
    server = created;
  }
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

export const stopSocketServer = async (): Promise<void> => {
  await closeSocketManager();
  const running = server;
  server = undefined;
  if (running) await new Promise<void>(resolve => running.close(() => resolve()));
};

/** Connect an authenticated client, resolving once the handshake succeeds. */
export const connectClient = (
  url: string,
  token: string
): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const client = ioClient(url, {
      auth: { token },
      transports: ['websocket'],
      // A rejected handshake must surface as a failure, not a retry loop that
      // ends in a Jest timeout with no explanation.
      reconnection: false,
      timeout: 5000,
    });
    client.on('connect', () => resolve(client));
    client.on('connect_error', err => {
      client.close();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });

/** Resolve with the next `event` payload, or reject if it never arrives. */
export const nextEvent = <T>(
  client: ClientSocket,
  event: string,
  ms = 5000
): Promise<T> =>
  new Promise((resolve, reject) => {
    const onEvent = (payload: T): void => {
      clearTimeout(timer);
      client.off(event, onEvent);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      client.off(event, onEvent);
      reject(new Error(`timed out waiting for "${event}"`));
    }, ms);
    client.on(event, onEvent);
  });

/**
 * Assert `event` does NOT arrive within the window — the shape a *suppressed*
 * relay takes (blocked peer, malformed target). Necessarily a timed wait: there
 * is no negative acknowledgement to await.
 */
export const expectNoEvent = async (
  client: ClientSocket,
  event: string,
  ms = 750
): Promise<void> => {
  const received: unknown[] = [];
  const onEvent = (payload: unknown): void => {
    received.push(payload);
  };
  client.on(event, onEvent);
  await new Promise<void>(resolve => setTimeout(resolve, ms));
  client.off(event, onEvent);
  if (received.length > 0) {
    throw new Error(
      `expected no "${event}" but received ${JSON.stringify(received)}`
    );
  }
};
