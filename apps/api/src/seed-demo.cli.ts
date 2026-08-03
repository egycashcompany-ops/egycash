// Runnable demo-pipeline entrypoint. The logic lives in seed-demo.ts (importable, no side
// effects); this boots the platform, applies or removes the demo cohorts, and exits.
//
//   npm run seed:demo             — place ten candidates at each recruitment stage
//   npm run seed:demo -- --reset  — remove every demo candidate and what they produced
//
// Requires the reference seed (`npm run seed`) to have run first: the demo candidates need the
// applicant sources, interview stages and evaluation phases that seed creates.
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { env } from './infrastructure/config/env';
import { userService } from './platform/users';
import { resetDemoPipeline, seedDemoPipeline } from './seed-demo';

const main = async (): Promise<void> => {
  const reset = process.argv.includes('--reset');
  await bootPlatform({ modules: moduleManifests });

  if (reset) {
    const { applicants } = await resetDemoPipeline();
    logger.info({ applicants }, 'demo pipeline reset complete');
  } else {
    const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
    if (admin === null) {
      throw new Error(`seed admin ${env.SEED_ADMIN_EMAIL} not found — run \`npm run seed\` first`);
    }
    const report = await seedDemoPipeline(String(admin._id));
    logger.info(report, 'demo pipeline seeded');
  }

  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'demo seed failed');
  process.exit(1);
});
