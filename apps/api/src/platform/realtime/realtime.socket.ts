// Topic-room membership for every authenticated socket (ADR-029). Auth itself lives in
// `notification.socket.ts` — its middleware verifies the JWT and stores the full AuthContext on
// `socket.data.authContext`; this module only reads that and joins the rooms the caller's
// permissions allow. Both attach to the SAME Socket.IO server (`initSocketServer` is
// idempotent), so one client connection serves personal notifications and entity topics alike.
import type { Server as HttpServer } from 'node:http';
import { initSocketServer } from '../../infrastructure/realtime/socket-server';
import { logger } from '../../infrastructure/logging/logger';
import { type AuthContext } from '../../shared/types';
import { roomsForContext } from './realtime-rooms';

/** Called once from the api entrypoint (`server.ts`), AFTER `attachNotificationSocket`. */
export const attachRealtimeSocket = (httpServer: HttpServer): void => {
  const io = initSocketServer(httpServer);
  io.on('connection', (socket) => {
    const ctx = (socket.data as { authContext?: AuthContext }).authContext;
    if (ctx === undefined) return; // unauthenticated sockets never reach here, but stay closed
    const rooms = roomsForContext(ctx);
    for (const room of rooms) void socket.join(room);
    logger.debug({ userId: ctx.userId, rooms: rooms.length }, 'realtime topic rooms joined');
  });
};
