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
// IT NEVER FAILS THE DEPLOY BECAUSE OF THE DATABASE, A DUPLICATE OR A SLOW BUILD. Railway does
// not start a deployment whose pre-deploy command exits non-zero, so a step that could fail would
// hold back every release behind it — and the api has run without these indexes until now. A
// unique index that existing rows violate is reported and left for a person to resolve; a
// database the step cannot reach, or a run that is still going after ten minutes, is logged as an
// error; in each case the process exits 0 and the deploy goes on, exactly as before this step
// existed. An invalid app environment (INDEX_SYNC_MODE=APPLY, say) fails env.ts at import, before
// any of this runs, and fails the deploy like any other — the app would not start with it either.
import mongoose from 'mongoose';
import { env } from './infrastructure/config/env';
import { connectMongo, disconnectMongo } from './infrastructure/database/mongo';
import { logger } from './infrastructure/logging/logger';
import {
  failureReason,
  indexSyncModeFrom,
  reportLines,
  reportSummary,
  syncDeclaredIndexes,
} from './shared/base/index-sync';

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
  // Built and would-build at info; anything left unbuilt or unlike its declaration at warn.
  for (const line of [...reportLines(report), reportSummary(report)]) {
    logger[line.level](line.fields, line.msg);
  }
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
    // The reason only, never the raw error: a server message can quote field values. An error of
    // our own (no server code) also gets its stack frames, which name code and never data; the
    // first line of the stack repeats the message, so it is left out.
    const serverError = typeof (error as { code?: unknown } | null)?.code === 'number';
    const frames =
      !serverError && error instanceof Error
        ? error.stack?.split('\n').slice(1).join('\n')
        : undefined;
    logger.error(
      { reason: failureReason(error), ...(frames === undefined ? {} : { frames }) },
      'index sync failed — nothing more was built; the deploy goes on',
    );
    await disconnectMongo().catch(() => undefined);
    process.exit(0);
  });
