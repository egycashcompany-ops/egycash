// Retire the fixed crew's legacy `workTypeId` field (الطقم الثابت — «نوع المهمة»).
//
//   npm run fleet:fix-crew-mission                # DRY RUN — reads, writes nothing
//   npm run fleet:fix-crew-mission -- --commit    # $unset the retired field
//
// The column stores `missionTypeId` now, validated against the `missionType` catalog
// (أنواع المهمات). For one release it stored `workTypeId`, validated against `workType`
// (أنواع الأعمال) — the workshop's vocabulary. This removes the retired field; it does NOT
// translate any value into a mission type, because no authoritative correspondence between the
// two catalogs exists and inventing one would put a mission on a car that nobody chose.
//
// READ THE DRY RUN FIRST. It prints every distinct legacy id with the catalog item it actually
// resolves to, and the mission vocabulary a reader will pick from afterwards. If the two lists
// suggest an obvious human mapping, that mapping is a decision for Operations to make in the UI —
// not something this script should guess.
//
// Nothing is lost: every value is still in the audit trail under its original key. This does not
// touch `platform_audit`, deliberately — an audit log records what was true at the time.
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import {
  inspectLegacyWorkTypes,
  retireLegacyWorkTypes,
} from './modules/fleet/fixed-roster/legacy-work-type-retirement';

const main = async (): Promise<void> => {
  // Opt IN to writing. A migration that writes by default is one an operator runs against the
  // wrong database exactly once.
  const commit = process.argv.includes('--commit');

  await bootPlatform({ modules: moduleManifests });
  const report = await inspectLegacyWorkTypes();

  logger.info(
    {
      liveRows: report.liveRows,
      rowsWithLegacyValue: report.rowsWithLegacyValue,
      distinct: report.distinct,
      activeMissionTypes: report.activeMissionTypes,
    },
    'fixed crew — legacy workTypeId inspection',
  );

  if (!commit) {
    logger.info(
      { wouldUnsetRows: report.rowsWithLegacyValue },
      'DRY RUN — nothing written. Re-run with --commit to retire the field.',
    );
  } else {
    const result = await retireLegacyWorkTypes();
    logger.info(
      { ...result, remapped: 0 },
      'retired workTypeId from the fixed crew — no value was translated into a mission type',
    );
  }

  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'fixed crew mission-type migration failed');
  process.exit(1);
});
