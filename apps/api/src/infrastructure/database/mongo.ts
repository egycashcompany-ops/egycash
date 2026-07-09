// MongoDB connection (ADR-005) + slow-query telemetry (Review R30):
// command monitoring logs any operation slower than SLOW_QUERY_MS so index
// gaps surface before users feel them.
import mongoose from 'mongoose';
import { env, isProduction } from '../config/env';
import { logger } from '../logging/logger';

export const connectMongo = async (uri: string = env.MONGO_URI): Promise<void> => {
  mongoose.set('strictQuery', true);
  mongoose.set('autoIndex', !isProduction); // index sync is a deploy step in production

  const started = new Map<number, { name: string; startedAt: number }>();

  await mongoose.connect(uri, { monitorCommands: true });

  const client = mongoose.connection.getClient();
  client.on('commandStarted', (event) => {
    started.set(event.requestId, { name: event.commandName, startedAt: Date.now() });
  });
  const finish = (requestId: number) => {
    const entry = started.get(requestId);
    started.delete(requestId);
    return entry;
  };
  client.on('commandSucceeded', (event) => {
    const entry = finish(event.requestId);
    if (entry !== undefined && event.duration >= env.SLOW_QUERY_MS) {
      logger.warn({ command: entry.name, durationMs: event.duration }, 'slow mongo operation');
    }
  });
  client.on('commandFailed', (event) => {
    finish(event.requestId);
  });

  logger.info({ db: mongoose.connection.name }, 'mongo connected');
};

export const disconnectMongo = async (): Promise<void> => {
  await mongoose.disconnect();
};

export const mongoReady = (): boolean => mongoose.connection.readyState === 1;
