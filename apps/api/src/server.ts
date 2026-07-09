// ENTRYPOINT: api process.
import { initSentry } from './infrastructure/observability/sentry';
import { env } from './infrastructure/config/env';
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { buildApp } from './app';

const main = async (): Promise<void> => {
  initSentry('api');
  await bootPlatform({ modules: moduleManifests });

  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'api listening');
  });

  // Graceful shutdown: stop accepting → drain → close pools (Deployment Strategy §1).
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()])
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'api boot failed');
  process.exit(1);
});
