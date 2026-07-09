// Generic Socket.IO transport plumbing (Sprint 3.3 plan §2). This module knows
// nothing about auth or notifications — it only: (a) attaches a Socket.IO server to
// the api process's HTTP server, and (b) lets ANY process (including the worker,
// which never has its own Socket.IO server) deliver an event to a room.
//
// Why the Redis relay exists: `platform.audit.alertRaised` (Sprint 3.2) is a
// RELIABLE-tier event — its subscriber runs wherever the outbox queue is consumed,
// which is the WORKER process (ADR-009), not the api process where Socket.IO lives.
// Without this relay, "emit on the in-process Socket.IO server" (the plan's own
// wording) would silently do nothing for that call. A plain Redis pub/sub channel —
// no new dependency, `ioredis` is already in the stack — closes that gap; this is
// the same mechanism the plan already named for horizontal API scaling, applied here
// to the (also already-existing) worker/api process split.
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Redis } from 'ioredis';
import { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';
import { env, isTest } from '../config/env';
import { logger } from '../logging/logger';

const RELAY_CHANNEL = 'ecms:realtime:relay';

const RelayMessageSchema = z.object({
  room: z.string(),
  event: z.string(),
  payload: z.unknown(),
  originId: z.string(),
});

let io: SocketIOServer | null = null;
let publisher: Redis | null = null;
let subscriber: Redis | null = null;
/** Distinguishes this process's own publishes so it doesn't re-emit its own relay message. */
const processId = randomUUID();

/** Called once, from the api entrypoint only (`server.ts`) — never from the worker. */
export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
  if (io !== null) return io;
  io = new SocketIOServer(httpServer, { cors: { origin: env.CORS_ORIGINS, credentials: true } });

  if (!isTest) {
    subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    subscriber.on('error', (error) => logger.error({ err: error }, 'realtime relay subscriber error'));
    subscriber.subscribe(RELAY_CHANNEL).catch((error: unknown) => {
      logger.error({ err: error }, 'realtime relay subscribe failed');
    });
    subscriber.on('message', (_channel, raw) => {
      const parsed = RelayMessageSchema.safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success || parsed.data.originId === processId) return; // our own publish, already emitted locally
      io?.to(parsed.data.room).emit(parsed.data.event, parsed.data.payload);
    });
  }

  return io;
};

/** Non-null only in the process that called `initSocketServer` (the api process). */
export const getSocketServer = (): SocketIOServer | null => io;

const getPublisher = (): Redis => {
  publisher ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return publisher;
};

/**
 * Deliver `event` to every socket in `room`, regardless of which process (api or
 * worker) calls this. Best-effort (Sprint 3.3 plan §2/§6) — a delivery failure here
 * never throws back to the caller.
 */
export const emitToRoom = (room: string, event: string, payload: unknown): void => {
  if (io !== null) {
    io.to(room).emit(event, payload);
  }
  if (isTest) return; // single-process test harness — the local emit above is sufficient
  const message = JSON.stringify({ room, event, payload, originId: processId });
  getPublisher()
    .publish(RELAY_CHANNEL, message)
    .catch((error: unknown) => {
      logger.warn({ err: error, room, event }, 'realtime relay publish failed');
    });
};

export const closeSocketServer = async (): Promise<void> => {
  await new Promise<void>((resolve) => (io === null ? resolve() : io.close(() => resolve())));
  io = null;
  await Promise.allSettled([subscriber?.quit(), publisher?.quit()]);
  subscriber = null;
  publisher = null;
};
