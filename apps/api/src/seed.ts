// Runnable development/staging seed entrypoint. The seed DATA lives in seed-data.ts (importable,
// no side effects); this file boots the platform, applies it, and exits.
import { env } from './infrastructure/config/env';
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { seedDevData } from './seed-data';

const main = async (): Promise<void> => {
  await bootPlatform({ modules: moduleManifests });
  await seedDevData();
  logger.info(
    { admin: env.SEED_ADMIN_EMAIL, hr: env.SEED_HR_EMAIL },
    'seed complete — dev logins ready',
  );
  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'seed failed');
  process.exit(1);
});
