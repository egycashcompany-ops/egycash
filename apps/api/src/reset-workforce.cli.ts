// Pre-go-live workforce reset — the operator-invoked entrypoint.
//
//   npm run reset:workforce                       # dry run: counts everything, deletes nothing
//   npm run reset:workforce -- --write --confirm DELETE
//
// WHAT IT DOES. Removes every employee and everything filed against them, and every user account
// that does not hold `super-admin` or `platform-admin`. It is meant to be run ONCE, immediately
// before importing the real workforce, against a database holding test data.
//
// WHAT IT DELIBERATELY LEAVES. The audit trail, because it records what people did and history is
// not rewritten when an account is removed. The organization structure and every reference
// catalogue, because the import expects them. The Global Employee Number counter, because winding a
// sequence back reissues a number somebody already holds. And eight collections that merely NAME an
// employee while being records in their own right — gold receipts, traffic violations, vehicle and
// ATM maintenance, job offers — which are not touched at all, not even to clear the reference. See
// `workforce-reset/targets.ts`.
//
// THERE IS NO UNDO. `--write` alone is not enough: `--confirm DELETE` has to be typed too, so the
// destructive form cannot be produced by editing a previous command's flags.
import { writeFile } from 'node:fs/promises';
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { runReset } from './workforce-reset/reset';

const CONFIRMATION = 'DELETE';

const flag = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
};

const main = async (): Promise<void> => {
  const write = process.argv.includes('--write');
  if (write && flag('confirm') !== CONFIRMATION) {
    throw new Error(
      `--write also needs --confirm ${CONFIRMATION}. This deletes every employee and every ` +
        'non-administrator account, permanently and with no undo. Run without --write first and ' +
        'read the counts.',
    );
  }

  await bootPlatform({ modules: moduleManifests });
  const report = await runReset({ write });

  const reportPath = flag('report') ?? `workforce-reset-${write ? 'write' : 'dry-run'}.json`;
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // The survivors are printed rather than buried in the file: "who can still log in afterwards" is
  // the one answer somebody must read before typing --write, and it is short enough to read.
  logger.info(
    {
      survivors: report.survivors.map((s) => `${s.username ?? s.id} [${s.roles.join(',')}]`),
      accountsRemoved: report.doomed.length,
      employeesRemoved: report.employees,
      collectionsEmptied: report.purged.filter((p) => p.documents > 0).length,
      collectionsLeftAlone: report.untouched.length,
      employeeSequence: report.employeeSequence,
      reportPath,
    },
    write
      ? 'workforce reset complete'
      : 'workforce reset DRY RUN — nothing was deleted; re-run with --write --confirm DELETE',
  );

  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'workforce reset failed');
  process.exit(1);
});
