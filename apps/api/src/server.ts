// ENTRYPOINT: api process.
import { initSentry } from './infrastructure/observability/sentry';
import { env } from './infrastructure/config/env';
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { closeSocketServer } from './infrastructure/realtime/socket-server';
import { bootPlatform } from './platform/kernel/bootstrap';
import { attachNotificationSocket } from './platform/notifications';
import { moduleManifests } from './modules';
import { syncNavigationCatalog } from './seed-navigation';
import { syncHrOnlyAccounts } from './hr-only-access';
import { buildApp } from './app';

const main = async (): Promise<void> => {
  initSentry('api');
  await bootPlatform({ modules: moduleManifests });
  // Upgrades add navigation catalog entries — existing installs pick them up here (BF-1).
  await syncNavigationCatalog();
  // Re-assert the HR-only confinement AFTER boot's own role grants (the Leave module re-grants
  // `employee-self-service` on every start), so it cannot drift back open between seeds.
  await syncHrOnlyAccounts();

  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'api listening');
  });
  attachNotificationSocket(server); // Socket.IO runs in the api process only (§2/§6)

  // Graceful shutdown: stop accepting → drain → close pools (Deployment Strategy §1).
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      Promise.allSettled([disconnectMongo(), closeCache(), closeQueues(), closeSocketServer()])
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
