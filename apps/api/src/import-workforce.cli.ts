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
// employees in one burst, and nothing can recall it.
//
// `HR_PROVISION_MISSING_LOGINS=false` IS REQUIRED TO RUN THIS AT ALL, dry run included — not just
// to write with it, and not only before the next API restart. Booting the platform runs the login
// backfill, which sends exactly those messages before this command reads a single row. The guard
// is the first thing `main` does, ahead of the boot. See `workforce-boot-guard.ts`.
import { readFile, writeFile } from 'node:fs/promises';
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { env } from './infrastructure/config/env';
import { userService } from './platform/users';
import { assertLoginProvisioningDisabled } from './workforce-boot-guard';
import { runImport } from './workforce-import/run';

const flag = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
};

const main = async (): Promise<void> => {
  // BEFORE THE BOOT, because the boot is what sends the messages. This import provisions nothing
  // itself, but `bootPlatform` runs the login backfill — so the check has to happen here, and has
  // to cover the dry run too. See `workforce-boot-guard.ts`.
  assertLoginProvisioningDisabled('import:workforce');

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
