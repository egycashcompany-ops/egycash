// Scan the files that were uploaded before the scanner existed — the operator's entrypoint.
//
//   node apps/api/dist/rescan-files.cli.js               # DRY RUN: counts, writes nothing
//   node apps/api/dist/rescan-files.cli.js --write        # mark them pending and queue the scans
//   node apps/api/dist/rescan-files.cli.js --write --batch 500
//
// (Locally: `npm run rescan:files -- --write`. On the deployed image only the built file exists.)
//
// WHAT IT DOES. Every live file still `unscanned` — the state every upload had on a deployment
// with no scanner — becomes `pending`, which withholds it from every download until the worker
// has a verdict, and a scan-only job is queued for it, oldest first. Nothing about the file
// changes but that status; a clean verdict serves it again within seconds, a hit blocks it.
//
// WHY IT IS A COMMAND AND NOT A BOOT. Switching the scanner on does not scan the backlog by
// itself: withholding every old attachment in the company at once, for as long as the worker
// takes to get through them, is a decision to take on purpose and at a chosen hour — not a
// side effect of a deploy. The dry run says how many that is.
//
// IT REFUSES WITHOUT A SCANNER. With `CLAMAV_HOST` unset nothing would ever answer, and a file
// marked `pending` would be withheld forever.
//
// `HR_PROVISION_MISSING_LOGINS=false` IS REQUIRED TO RUN THIS AT ALL, dry run included. Booting
// the platform runs the HR login backfill, which messages every employee who has no login —
// before this command reads a single row. See `workforce-boot-guard.ts`.
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { rescanBacklog } from './platform/files';
import { assertLoginProvisioningDisabled } from './workforce-boot-guard';

const flag = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
};

const main = async (): Promise<void> => {
  // BEFORE THE BOOT, because the boot is what sends the messages.
  assertLoginProvisioningDisabled('rescan:files');

  const write = process.argv.includes('--write');
  const batchFlag = flag('batch');
  const batch = batchFlag === null ? undefined : Number(batchFlag);
  if (batch !== undefined && (!Number.isInteger(batch) || batch < 1 || batch > 5_000)) {
    throw new Error(`--batch must be a whole number between 1 and 5000 (got "${batchFlag ?? ''}")`);
  }

  await bootPlatform({ modules: moduleManifests });

  const report = await rescanBacklog({
    write,
    ...(batch === undefined ? {} : { batch }),
    onBatch: (progress) => logger.info(progress, 'rescan: batch done'),
  });

  if (!write) {
    logger.info(
      { unscanned: report.unscanned },
      report.unscanned === 0
        ? 'DRY RUN — every live file has been scanned already; nothing to do.'
        : 'DRY RUN — this many files would be withheld until scanned. Re-run with --write to do it.',
    );
  } else {
    logger.info(report, 'rescan: queued. Watch the worker log; the sweep retries anything left.');
  }

  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'rescan failed');
  process.exit(1);
});
