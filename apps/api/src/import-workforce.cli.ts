// Go-live workforce import — the operator-invoked entrypoint.
//
//   npm run import:workforce -- --file ./IT.xlsx              # dry run: reads, plans, reports
//   npm run import:workforce -- --file ./IT.xlsx --write      # the same run, actually writing
//
// A CLI AND NOT A BOOT MIGRATION, deliberately. `server.ts` and `worker.ts` both call
// `bootPlatform`, and there is no leader election between them — a migration would run twice
// against the same database, racing itself. This runs once, when a person decides it should.
//
// DRY RUN IS THE DEFAULT. `--write` is the only thing that makes it write, so the harmless
// invocation is also the shortest one to type.
//
// IT NEVER CREATES A LOGIN AND NEVER SENDS ANYTHING. `registerDirect` is called with
// `provisionLogin: false`, so no account is made, no WhatsApp message goes out and no email is
// sent. That is not a nicety: the default path would deliver a one-time setup link to ~1,670 real
// employees in one burst, and nothing can recall it. Set `HR_PROVISION_MISSING_LOGINS=false`
// before the NEXT API restart too — the boot backfill would otherwise do exactly that.
import { readFile, writeFile } from 'node:fs/promises';
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { env } from './infrastructure/config/env';
import { userService } from './platform/users';
import { runImport } from './workforce-import/run';

const flag = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
};

const main = async (): Promise<void> => {
  const file = flag('file');
  if (file === null || file === '') {
    throw new Error('usage: import:workforce -- --file <path to the workbook> [--write] [--report <path>]');
  }
  // Read it here so a bad path fails before the platform boots rather than after.
  await readFile(file);

  const write = process.argv.includes('--write');
  await bootPlatform({ modules: moduleManifests });

  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    throw new Error(`seed admin ${env.SEED_ADMIN_EMAIL} not found — run \`npm run seed\` first`);
  }

  if (write && env.HR_PROVISION_MISSING_LOGINS) {
    // Refuse rather than warn. The import itself provisions nothing, but the next API restart
    // would provision everyone it just created and message them all — and by then the operator is
    // no longer at the keyboard to notice.
    throw new Error(
      'refusing to write while HR_PROVISION_MISSING_LOGINS=true — the next API restart would ' +
        'send a setup link by WhatsApp and email to every employee this import creates. Set it to ' +
        'false, run the import, and turn it back on when accounts are meant to go out.',
    );
  }

  const report = await runImport({ file, write, actorId: String(admin._id) });

  const reportPath = flag('report') ?? `workforce-import-${write ? 'write' : 'dry-run'}.json`;
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  logger.info(
    {
      mode: write ? 'WRITE' : 'dry run',
      ...report.counts,
      rejectedRows: report.rejected.length,
      reportPath,
    },
    write ? 'workforce import complete' : 'workforce import dry run complete — nothing was written',
  );

  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'workforce import failed');
  process.exit(1);
});
