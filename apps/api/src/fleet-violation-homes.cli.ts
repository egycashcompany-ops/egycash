// Give carried fines back the car they came from (مخالفات — «محمولة على»).
//
//   npm run fleet:violation-homes                # DRY RUN — reads, writes nothing
//   npm run fleet:violation-homes -- --commit    # write the recovered homes
//
// Dropping a driver's fine onto another car moves it there. For one release that overwrite kept
// nothing, so pressing the «محمولة على» badge cleared the year and left the fine on the car it
// had been dropped onto instead of the one it came from. `homeVehicleId` fixes that for every
// move from now on; this recovers the same answer for the rows moved before it existed, from the
// audit entry each move wrote.
//
// READ THE DRY RUN FIRST. It prints every carried fine with the car it is on, the car the trail
// says it came from, and the block it is counted in — and it names the ones no home could be
// recovered for, with the reason. Nothing is guessed: a fine whose trail holds no carry is left
// alone rather than sent to a car somebody would have to un-guess later.
//
// `platform_audit` is READ and never written.
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import {
  inspectCarriedHomes,
  restoreCarriedHomes,
} from './modules/fleet/violations/carried-home-backfill';

const main = async (): Promise<void> => {
  // Opt IN to writing. A migration that writes by default is one an operator runs against the
  // wrong database exactly once.
  const commit = process.argv.includes('--commit');

  await bootPlatform({ modules: moduleManifests });
  const report = await inspectCarriedHomes();

  logger.info(
    {
      carried: report.carried,
      alreadyHome: report.alreadyHome,
      recoverable: report.restores.length,
      unrecoverable: report.unrecoverable,
      restores: report.restores,
    },
    'violations — carried fines and the cars they came from',
  );

  if (!commit) {
    logger.info(
      { wouldRestore: report.restores.length },
      'DRY RUN — nothing written. Re-run with --commit to write the recovered homes.',
    );
  } else {
    const result = await restoreCarriedHomes(report.restores);
    logger.info(
      { ...result, movedFines: 0 },
      'wrote the recovered homes — no fine was moved, only the way back was restored',
    );
  }

  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'violation carried-home backfill failed');
  process.exit(1);
});
