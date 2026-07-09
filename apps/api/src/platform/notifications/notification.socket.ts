// Socket.IO auth + room join (Sprint 3.3 plan §2/§6). The low-level transport
// (attaching Socket.IO to the HTTP server, cross-process delivery) lives in
// `infrastructure/realtime` — this file is the one place that knows notifications
// means rooms named `user:<id>` and that connecting requires the same JWT the HTTP
// `authenticate` middleware verifies.
import type { Server as HttpServer } from 'node:http';
import { type Socket } from 'socket.io';
import { emitToRoom, initSocketServer } from '../../infrastructure/realtime/socket-server';
import { logger } from '../../infrastructure/logging/logger';
import { authService } from '../auth';

export const roomForUser = (userId: string): string => `user:${userId}`;

interface AuthedSocket extends Socket {
  data: { userId?: string };
}

/** Called once from the api entrypoint (`server.ts`) only — never from the worker. */
export const attachNotificationSocket = (httpServer: HttpServer): void => {
  const io = initSocketServer(httpServer);

  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    if (typeof token !== 'string' || token === '') {
      next(new Error('unauthenticated'));
      return;
    }
    void authService
      .buildAuthContext(token)
      .then((ctx) => {
        (socket as AuthedSocket).data.userId = ctx.userId;
        next();
      })
      .catch(() => next(new Error('unauthenticated')));
  });

  io.on('connection', (socket) => {
    const userId = (socket as AuthedSocket).data.userId;
    if (userId === undefined) {
      socket.disconnect(true);
      return;
    }
    void socket.join(roomForUser(userId));
    logger.debug({ userId, socketId: socket.id }, 'notifications socket connected');
  });
};

/** Best-effort live push — a missed delivery is not a lost notification (§1). */
export const emitNotificationEvent = (userId: string, event: string, payload: unknown): void => {
  emitToRoom(roomForUser(userId), event, payload);
};
