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
import { attachRealtimeSocket } from './platform/realtime';
import { moduleManifests } from './modules';
import { syncNavigationCatalog } from './seed-navigation';
import { syncApplicationSections } from './seed-application-sections';
import { syncHrOnlyAccounts } from './hr-only-access';
import { startVehicleGoLive } from './modules/fleet/go-live/vehicles';
import { buildApp } from './app';

const main = async (): Promise<void> => {
  initSentry('api');
  await bootPlatform({ modules: moduleManifests });
  // Upgrades add navigation catalog entries — existing installs pick them up here (BF-1).
  await syncNavigationCatalog();
  // The same default sections on an EXISTING install — additive and idempotent: it creates a
  // section only when one by that name is absent, and assigns only still-unsectioned rows, so an
  // administrator's own organization is never re-imposed on.
  await syncApplicationSections();
  // Re-assert the HR-only confinement AFTER boot's own role grants (the Leave module re-grants
  // `employee-self-service` on every start), so it cannot drift back open between seeds.
  await syncHrOnlyAccounts();

  // The Fleet go-live import — 209 cars and their licence scans, once per database.
  //
  // HERE AND NOT IN THE MODULE SEED, because the seed runs inside `bootPlatform` and ten
  // short-lived entrypoints call that: `seed.ts` and nine CLIs, each of which disconnects and
  // exits the moment its own work is done. A background import started under one of those is
  // killed part-written with its mark already claimed.
  //
  // DELIBERATELY NOT AWAITED, and placed immediately before `listen()` to make that visible:
  // /health/ready must answer inside railway.json's 300s or the deploy is failed and retried, and
  // 23MB of scans through the Files pipeline has no business sitting in front of it. The worker
  // starts it too; `markOnce` decides which of them actually runs.
  startVehicleGoLive();

  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'api listening');
  });
  attachNotificationSocket(server); // Socket.IO runs in the api process only (§2/§6)
  // AFTER attachNotificationSocket: its auth middleware supplies the AuthContext this reads.
  attachRealtimeSocket(server);

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
