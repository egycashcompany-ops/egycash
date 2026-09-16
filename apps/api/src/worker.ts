// ENTRYPOINT: worker process — BullMQ consumers for audit, outbox and scheduled
// queues (ADR-009). Deployed as a separate service from day one.
import { initSentry } from './infrastructure/observability/sentry';
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues, startWorkers } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { schedulerService } from './platform/scheduler';
import { moduleManifests } from './modules';
import { startVehicleGoLive } from './modules/fleet/go-live/vehicles';
import { startDriverPhotosGoLive } from './modules/fleet/go-live/driver-photos';
import { startOdometerGoLive } from './modules/fleet/go-live/odometer';
import { startMaintenanceGoLive } from './modules/fleet/go-live/maintenance';

const main = async (): Promise<void> => {
  initSentry('worker');
  await bootPlatform({ modules: moduleManifests });

  // The Fleet go-live import — see `server.ts` for why it is started by the long-running processes
  // and not by the module seed. Both start it and the lease elects one; the worker is here so the
  // cars still arrive on a deployment whose api happens to come up second, or not at all.
  startVehicleGoLive();
  startDriverPhotosGoLive();
  startOdometerGoLive();
  startMaintenanceGoLive();

  const workers = startWorkers();
  await schedulerService.startSchedules();
  logger.info({ queues: workers.map((w) => w.name) }, 'worker running');

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'worker shutting down');
    Promise.allSettled(workers.map((worker) => worker.close()))
      .then(() => Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]))
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
    setTimeout(() => process.exit(1), 30_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'worker boot failed');
  process.exit(1);
});
