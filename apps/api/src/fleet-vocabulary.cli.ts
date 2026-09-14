// Put the house's Fleet vocabulary into the catalogs — the operator-invoked entrypoint.
//
//   npm run seed:fleet-vocabulary            # dry run: reads, plans, reports. Writes NOTHING.
//   npm run seed:fleet-vocabulary -- --write # the same run, actually writing
//
// DRY RUN IS THE DEFAULT, so the harmless invocation is also the shortest one to type — the same
// bargain `import:workforce` makes, and for the same reason: this writes to a database somebody is
// already using, and the first thing anyone wants is to see what it would do.
//
// IT IS IDEMPOTENT AND IT ONLY ADDS. A name already in the catalog is left exactly as it is, and
// nothing is ever renamed, deactivated or deleted. The single exception is stated out loud in the
// report: a work type that MUST reset the maintenance counter and is not flagged gets flagged, on
// the grounds that an unflagged «صيانة» is the silent failure this list exists to end.
//
// A CLI AND NOT A BOOT STEP, deliberately: `server.ts` and `worker.ts` both boot the platform with
// no leader election between them, so a boot-time seed would race itself. This runs once, when a
// person decides it should.
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { env } from './infrastructure/config/env';
import { userService } from './platform/users';
import { applyFleetVocabulary, planFleetVocabulary, type VocabularyPlan } from './fleet-vocabulary';

const report = (plan: VocabularyPlan, wrote: boolean): void => {
  const byKind = new Map<string, { create: string[]; flag: string[] }>();
  for (const change of plan.changes) {
    const bucket = byKind.get(change.kind) ?? { create: [], flag: [] };
    bucket[change.action].push(change.name);
    byKind.set(change.kind, bucket);
  }
  for (const [kind, bucket] of byKind) {
    if (bucket.create.length > 0) {
      logger.info(
        { kind, count: bucket.create.length, names: bucket.create },
        wrote ? 'created' : 'would create',
      );
    }
    // Loud, and on its own line: this is the one change that touches a row somebody else made.
    if (bucket.flag.length > 0) {
      logger.warn(
        { kind, names: bucket.flag },
        wrote
          ? 'flagged as counting for the maintenance alarm'
          : 'would flag as counting for the maintenance alarm',
      );
    }
  }
  logger.info(
    { changes: plan.changes.length, unchanged: plan.unchanged },
    wrote ? 'fleet vocabulary applied' : 'fleet vocabulary dry run — nothing was written',
  );
};

const main = async (): Promise<void> => {
  const write = process.argv.includes('--write');
  await bootPlatform({ modules: moduleManifests });

  const plan = await planFleetVocabulary();
  if (!write) {
    report(plan, false);
    logger.info('re-run with --write to apply');
  } else {
    const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
    if (admin === null) {
      throw new Error(`seed admin ${env.SEED_ADMIN_EMAIL} not found — run \`npm run seed\` first`);
    }
    await applyFleetVocabulary(plan, String(admin._id));
    report(plan, true);
  }

  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'fleet vocabulary seed failed');
  process.exit(1);
});
