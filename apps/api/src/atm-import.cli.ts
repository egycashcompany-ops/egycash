// ATM-7 entrypoint — import ONE legacy ATM deployment into ONE ECMS branch.
//
//   npm run atm:import -- --legacy-uri=mongodb://host:27017/egycash --branch=<objectId> --dry-run
//   npm run atm:import -- --legacy-uri=… --branch=<objectId>
//
// Flags:
//   --legacy-uri=<uri>       REQUIRED. The legacy deployment's database (read-only usage).
//   --branch=<objectId>      REQUIRED. The ECMS branch this deployment's data belongs to. A branch
//                            WAS a deployment in the legacy system, so one run per branch.
//   --rep-time=cairo|utc     How that deployment wrote replenishment open times. Default `cairo`
//                            (the legacy bug — local parts stamped +00:00, contad_app.js:644-650),
//                            which the import repairs. Pass `utc` for a deployment already fixed.
//   --maint-time=cairo|utc   The same for maintenance. Default `utc` — that path moved to
//                            moment-tz (:1902-1905) — but rows written BEFORE that change are
//                            Cairo-labelled, so sample a few before trusting the default.
//   --dry-run                Read and report, write nothing.
//
// SAMPLE BEFORE YOU COMMIT. The two time modes are indistinguishable in the data (a row reading
// 10:00Z is either 10:00 Cairo mislabelled or 12:00 Cairo recorded honestly), so run `--dry-run`,
// then import into a scratch database and check a handful of rows whose real times somebody
// remembers. Getting this wrong shifts a whole deployment's history by two or three hours.
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { importLegacyAtmDeployment } from './modules/atm/migration/legacy-import';
import { type LegacyTimeMode } from './modules/atm/migration/legacy-transform';

const flag = (name: string): string | null => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
};

const timeMode = (name: string, fallback: LegacyTimeMode): LegacyTimeMode => {
  const raw = flag(name);
  if (raw === null) return fallback;
  if (raw === 'cairo') return 'cairo-labelled';
  if (raw === 'utc') return 'utc';
  throw new Error(`--${name} must be 'cairo' or 'utc', got '${raw}'`);
};

const main = async (): Promise<void> => {
  const legacyUri = flag('legacy-uri');
  const branchId = flag('branch');
  if (legacyUri === null || branchId === null) {
    throw new Error('--legacy-uri=<uri> and --branch=<objectId> are both required');
  }
  if (!/^[0-9a-fA-F]{24}$/.test(branchId)) {
    throw new Error(`--branch must be a 24-hex-char ObjectId, got '${branchId}'`);
  }

  await bootPlatform({ modules: moduleManifests });
  const report = await importLegacyAtmDeployment({
    legacyUri,
    branchId,
    replenishmentTime: timeMode('rep-time', 'cairo-labelled'),
    maintenanceTime: timeMode('maint-time', 'utc'),
    dryRun: process.argv.includes('--dry-run'),
  });

  logger.info(report, report.dryRun ? 'atm import DRY RUN — nothing written' : 'atm import done');
  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'atm import failed');
  process.exit(1);
});
