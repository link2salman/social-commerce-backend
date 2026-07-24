import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { required, optionalEnv } from '@utils/env';
import logger from '@utils/logger';
import User from '@models/user/User';
import { isTokenRevoked } from '@middlewares/auth';
import { assertAccessSessionActive } from '@services/authSessionService';
import type { AccessJwtPayload } from '@utils/generateAccessToken';
import type { AppServer, AppSocket, SocketUser } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated realtime layer. Every connection must present a valid access
// JWT (the app connects on login — see the app's callSignaling / chat socket).
// Each socket joins `user:<id>`, an adapter-federated room used for presence and
// directed emits. This class owns only the connection lifecycle; the chat and
// WebRTC call-signaling handlers are registered onto it by socket/index.ts
// (`manager.use(registerChatHandlers)` / `registerCallHandlers`), which is the
// single entry point server.ts boots.
// ─────────────────────────────────────────────────────────────────────────────

type HandlerRegistrar = (io: AppServer, socket: AppSocket) => void;

class SocketManager {
  private io!: AppServer;
  private adapterClients: Redis[] = [];
  private registrars: HandlerRegistrar[] = [];
  private closed = false;

  constructor(server: HTTPServer) {
    void this.init(server);
  }

  /** Register a set of event handlers applied to every future connection. */
  public use(registrar: HandlerRegistrar): void {
    this.registrars.push(registrar);
  }

  private async init(server: HTTPServer): Promise<void> {
    const origins = optionalEnv('FRONTEND_URLS')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    this.io = new SocketIOServer<
      never,
      never,
      never,
      SocketUser
    >(server, {
      cors: {
        // The native app sends no Origin; browsers must be in FRONTEND_URLS.
        origin: (origin, cb) =>
          !origin || origins.includes(origin)
            ? cb(null, true)
            : cb(new Error('Not allowed by CORS')),
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6,
    }) as unknown as AppServer;

    // Redis adapter — horizontal scale. Optional (in-memory single-instance
    // fallback when REDIS_URL is unset), mirroring the reference backend.
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        const pub = new Redis(redisUrl, { lazyConnect: true });
        const sub = pub.duplicate();
        await Promise.all([pub.connect(), sub.connect()]);
        this.io.adapter(createAdapter(pub, sub));
        this.adapterClients = [pub, sub];
        logger.info('socket: Redis adapter enabled (horizontal scaling ready)');
      } catch (err) {
        logger.error(
          { err },
          'socket: Redis adapter failed — falling back to in-memory'
        );
      }
    } else {
      logger.warn('socket: REDIS_URL unset — in-memory adapter (single instance)');
    }

    this.io.use((socket, next) => void this.authenticate(socket, next));
    this.io.on('connection', socket => this.onConnection(socket));
  }

  private async authenticate(
    socket: AppSocket,
    next: (err?: Error) => void
  ): Promise<void> {
    try {
      const raw =
        (socket.handshake.auth?.token as string | undefined) ||
        socket.handshake.headers.authorization?.replace('Bearer ', '');
      if (!raw) return next(new Error('Authentication required'));

      let decoded: AccessJwtPayload;
      try {
        // Pin the algorithm — same policy as the HTTP middleware.
        decoded = jwt.verify(raw, required('JWT_SECRET'), {
          algorithms: ['HS256'],
        }) as AccessJwtPayload;
      } catch {
        return next(new Error('Invalid or expired token'));
      }

      if (await isTokenRevoked(raw)) return next(new Error('Token revoked'));
      try {
        await assertAccessSessionActive(decoded.userId, decoded.sessionId);
      } catch {
        return next(new Error('Session revoked'));
      }

      const user = await User.findByPk(decoded.userId, {
        attributes: ['user_id', 'username', 'avatar_url', 'is_active'],
      });
      if (!user) return next(new Error('User not found'));
      if (!user.is_active) return next(new Error('Account is inactive'));

      socket.data = {
        user_id: user.user_id,
        username: user.username,
        avatar_url: user.avatar_url,
        socket_id: socket.id,
        token: raw,
        token_exp: (decoded as { exp?: number }).exp,
        session_id: decoded.sessionId,
        joinedConversations: new Set<string>(),
      } satisfies SocketUser;

      next();
    } catch (err) {
      logger.error({ err }, 'socket: authentication error');
      next(new Error('Authentication failed'));
    }
  }

  private onConnection(socket: AppSocket): void {
    const user = socket.data;
    void socket.join(`user:${user.user_id}`);
    logger.debug({ socketId: socket.id, userId: user.user_id }, 'socket connected');

    // A socket is authenticated once at the handshake; without this it would
    // outlive its short-lived access token (revocation is only re-checked on a
    // new HTTP request or a new connection). Schedule a disconnect at the
    // token's expiry so a long-lived socket can't outlast the credential that
    // opened it — the client reconnects with a freshly-rotated token.
    if (user.token_exp) {
      const msUntilExpiry = user.token_exp * 1000 - Date.now();
      if (msUntilExpiry <= 0) {
        socket.disconnect(true);
        return;
      }
      const expiryTimer = setTimeout(() => {
        socket.emit('session:expired');
        socket.disconnect(true);
      }, msUntilExpiry);
      expiryTimer.unref();
      socket.on('disconnect', () => clearTimeout(expiryTimer));
    }

    socket.on('ping', (id?: unknown) => socket.emit('pong', id));

    for (const register of this.registrars) register(this.io, socket);

    socket.on('disconnect', reason => {
      logger.debug(
        { socketId: socket.id, userId: user.user_id, reason },
        'socket disconnected'
      );
    });
  }

  /** Emit to every socket a user has open, across all instances. */
  public sendToUser(userId: string, event: string, data: unknown): void {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  public async isUserOnline(userId: string): Promise<boolean> {
    const sockets = await this.io.in(`user:${userId}`).fetchSockets();
    return sockets.length > 0;
  }

  public getIO(): AppServer {
    return this.io;
  }

  public async close(): Promise<void> {
    if (this.closed || !this.io) return;
    this.closed = true;
    this.io.local.disconnectSockets(true);
    await this.io.close();
    await Promise.all(
      this.adapterClients.map(async c => {
        try {
          await c.quit();
        } catch {
          c.disconnect();
        }
      })
    );
    this.adapterClients = [];
  }
}

let manager: SocketManager | null = null;

export const initSocketServer = (server: HTTPServer): SocketManager => {
  if (!manager) manager = new SocketManager(server);
  return manager;
};

export const getSocketManager = (): SocketManager => {
  if (!manager) throw new Error('Socket manager not initialized');
  return manager;
};

/** Safe even if the socket layer never started (boot failure path). */
export const closeSocketServer = async (): Promise<void> => {
  if (manager) await manager.close();
};
