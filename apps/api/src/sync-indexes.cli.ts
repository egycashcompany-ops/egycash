// Build the indexes the schemas declare — the deploy step, run before every API deploy.
//
//   node apps/api/dist/sync-indexes.cli.js            # REPORT: what is missing; builds nothing
//   node apps/api/dist/sync-indexes.cli.js --apply    # build what the report lists
//
// `INDEX_SYNC_MODE=apply` does the same as `--apply`, which is how the Railway pre-deploy command
// (railway.json) is switched from reporting to building without a code change: the first deploys
// only report, an operator reads the report in the deploy log, and then flips the variable.
//
// IT DOES NOT BOOT THE PLATFORM. `bootPlatform` runs seeds, migrations and the HR login backfill,
// which messages employees — none of which belongs in a deploy step. This connects, loads the
// models (the same imports the api makes), compares, and exits. See shared/base/index-sync.ts for
// what it builds and what it refuses to.
//
// IT NEVER FAILS THE DEPLOY. Railway does not start a deployment whose pre-deploy command exits
// non-zero, so a step that could fail would hold back every release behind it — and the api has
// run without these indexes until now. A unique index that existing rows violate is reported and
// left for a person to resolve; a database the step cannot reach, or a run that is still going
// after ten minutes, is logged as an error; in every case the process exits 0 and the deploy goes
// on, exactly as before this step existed.
import mongoose from 'mongoose';
import { env } from './infrastructure/config/env';
import { connectMongo, disconnectMongo } from './infrastructure/database/mongo';
import { logger } from './infrastructure/logging/logger';
import { indexSyncModeFrom, syncDeclaredIndexes } from './shared/base/index-sync';

/** Far more than this database needs; a step that hangs holds the deploy. */
const WATCHDOG_MS = 10 * 60_000;

const main = async (): Promise<void> => {
  const mode = indexSyncModeFrom(process.argv, env.INDEX_SYNC_MODE);
  await connectMongo();
  // Mongoose must not build anything on its own here, or a report run outside production would
  // find its own background builds instead of the database as it was. Set before the models load:
  // a model reads the option when it initialises.
  mongoose.set('autoIndex', false);
  await import('./sync-indexes.models');

  const report = await syncDeclaredIndexes(mode);
  for (const missing of report.missing) {
    logger.info(
      missing,
      mode === 'apply' ? 'index sync: missing index' : 'index sync: would build',
    );
  }
  for (const failure of report.failed) logger.warn(failure, 'index sync: index not built');
  logger.info(
    {
      mode,
      collections: report.collections,
      declared: report.declared,
      alreadyPresent: report.alreadyPresent,
      missing: report.missing.length,
      built: report.built.length,
      blockedByDuplicates: report.missing.filter((m) => m.duplicateGroups !== undefined).length,
      failed: report.failed.length,
    },
    mode === 'apply'
      ? 'index sync: done'
      : 'index sync: REPORT ONLY — nothing was built; set INDEX_SYNC_MODE=apply to build',
  );
};

setTimeout(() => {
  logger.error('index sync: still running after ten minutes — stopped; the deploy goes on');
  process.exit(0);
}, WATCHDOG_MS).unref();

main()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    logger.error({ err: error }, 'index sync failed — nothing more was built; the deploy goes on');
    await disconnectMongo().catch(() => undefined);
    process.exit(0);
  });
