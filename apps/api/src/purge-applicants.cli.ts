// Permanently erase named applicants and everything filed against them — operator-invoked.
//
// ON THE DEPLOYED IMAGE (the only place this is ever run), through the service shell:
//
//   node apps/api/dist/purge-applicants.cli.js --names-file /tmp/names.txt
//   node apps/api/dist/purge-applicants.cli.js --names-file /tmp/names.txt \
//       --write --confirm DELETE --as <username> --ids <the ids the dry run printed>
//
// Locally, `npm run purge:applicants -- --names-file …` does the same through tsx. The image
// installs with `--omit=dev`, so tsx is not there and the npm script cannot run — which is why
// this file is a tsup build entry (`operator-cli-build.spec.ts` keeps it one).
//
// WHY THIS EXISTS. Nothing in the system hard-deletes an applicant. `applicant.delete` soft-deletes
// (`isDeleted`), the documents folder soft-deletes its files and leaves the bytes in storage, and
// the only `deleteMany` over the applicant registry lives in `seed-demo.ts`, which throws when
// `NODE_ENV=production`. So "remove these people completely, the scans of their ID cards included"
// had no implementation, and doing it by hand in a shell is how a similar name gets caught in it.
//
// THE NAMES ARE NOT IN THIS FILE, and must never be. They are real people's names, so they are
// read at run time from a file the operator keeps OUTSIDE the repository — one exact `fullNameAr`
// per line, `#` for a comment. Committing them would put them in git history for good.
//
// HOW IT REFUSES TO GUESS. A name matching no applicant, or more than one, aborts the WHOLE run
// before anything is read — not just that name — and the refusal lists every unresolved name at
// once. `--status` (default `withdrawn`) is part of the match, not a filter applied afterwards, so
// a withdrawn candidate who shares a name with an active one is still an ambiguity this refuses to
// resolve on its own.
//
// HOW IT KNOWS WHAT TO DELETE. It carries no list. `applicantTargets()` walks every registered
// Mongoose schema for an applicant-naming path — including paths inside subdocument arrays — and
// refuses to start if it meets a collection nobody has classified in `workforce-reset/targets.ts`.
// That is the guard the workforce reset relies on, and it is why this keeps working when somebody
// ships a new recruitment collection next month. What it cannot derive is handled by hand and
// reported separately: the files, the portal account and the user-scoped rows behind it, and the
// evaluation batch that names several candidates (see `applicant-purge/purge.ts`).
//
// STAGE COUNTERS AND NAV BADGES NEED NO REPAIR. They are aggregates computed per request
// (`counters/stage-counts.service.ts` → `countByStatus`), not stored totals, so they are right the
// moment the rows are gone. No sequence is wound back either: reissuing a code somebody already
// holds is the mistake that would cause.
//
// THE AUDIT TRAIL IS NOT TOUCHED, and it gains rows — a `purge` per file with its fingerprint, and
// one per applicant naming what went and where the backup is. History is not rewritten because a
// record was removed.
//
// `--empty <collection,collection>` ADDITIONALLY EMPTIES THOSE COLLECTIONS IN FULL — every row,
// everybody's, not only the named applicants'. «أمسح كله ماعدا المتقدمين والفرز»: clearing the
// interview, evaluation and job-offer screens is a different act from erasing seven people, so it
// is a separate flag and a separate line in the report rather than something a name match can do
// by accident. Only a collection the applicant derivation already found may be named, so it can
// never reach the employee registry or the accounts. Both interview stages — «المقابلة الأولى»
// and «المقابلة الثانية» — are rows in `hr_interviews`, so emptying it clears both screens:
//
//   --empty hr_interviews,hr_evaluations,hr_job_offers
//
// What that deliberately does NOT touch: `hr_applicants` and `hr_screenings`, and the timeline
// entries that mention an emptied interview or offer. A reference left pointing at a record that
// no longer exists is the honest state — the same reasoning `workforce-reset/targets.ts` applies
// to a `keep` collection — and rewriting those rows would be a destructive edit nobody asked for.
//
// THERE IS NO UNDO, which is why `--write` is not enough on its own. It also needs `--confirm
// DELETE`, so the destructive form cannot be made by editing a previous command; `--ids`, the exact
// ids the dry run printed, so what was approved is provably what runs; and `--as <username>`, a
// real account, so the audit rows name an operator rather than a script. Every affected document is
// written to a backup file BEFORE the first delete, and a backup that cannot be written aborts.
//
// `HR_PROVISION_MISSING_LOGINS=false` IS REQUIRED TO RUN THIS AT ALL, dry run included — booting
// the platform runs the HR login backfill, which messages every employee who lacks a login before
// this command has read a single row. See `workforce-boot-guard.ts`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { APPLICANT_STATUSES, type ApplicantStatus } from '@ecms/contracts';
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { assertLoginProvisioningDisabled } from './workforce-boot-guard';
import {
  affectedDocuments,
  breakGlassContext,
  db,
  execute,
  planPurge,
  reportOf,
  type PurgeOptions,
} from './applicant-purge/purge';

const CONFIRMATION = 'DELETE';

const flag = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
};

const readNames = async (path: string): Promise<string[]> => {
  const lines = (await readFile(path, 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length === 0) throw new Error(`${path} holds no names`);
  const repeated = [...new Set(lines.filter((line, i) => lines.indexOf(line) !== i))];
  if (repeated.length > 0) throw new Error(`${path} repeats a name: ${repeated.join(', ')}`);
  return lines;
};

const operatorId = async (username: string): Promise<string> => {
  const row = await db()
    .collection('users')
    .findOne({ username }, { projection: { _id: 1 } });
  if (row === null) throw new Error(`--as ${username}: no such account`);
  return String(row['_id']);
};

const options = (names: string[], status: ApplicantStatus): PurgeOptions => ({
  names,
  status,
  write: process.argv.includes('--write'),
  keepFileBlobs: process.argv.includes('--keep-file-blobs'),
  approvedIds: (flag('ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== ''),
  operator: flag('as'),
  emptyCollections: (flag('empty') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== ''),
});

const main = async (): Promise<void> => {
  // BEFORE THE BOOT, because the boot is what sends the messages. See `workforce-boot-guard.ts`.
  assertLoginProvisioningDisabled('purge:applicants');

  const namesFile = flag('names-file');
  if (namesFile === null || namesFile === '') {
    throw new Error(
      '--names-file is required: a file OUTSIDE this repository holding one exact `fullNameAr` ' +
        'per line. The names are real people and must never be committed.',
    );
  }
  const statusFlag = flag('status') ?? 'withdrawn';
  if (!(APPLICANT_STATUSES as readonly string[]).includes(statusFlag)) {
    throw new Error(`--status ${statusFlag} is not one of ${APPLICANT_STATUSES.join(', ')}`);
  }

  const opts = options(await readNames(resolve(namesFile)), statusFlag as ApplicantStatus);
  if (opts.write && flag('confirm') !== CONFIRMATION) {
    throw new Error(
      `--write also needs --confirm ${CONFIRMATION}. This erases these applicants and every ` +
        'record and file filed against them, permanently and with no undo. Run without --write ' +
        'first and read the counts.',
    );
  }
  if (opts.write && (opts.operator === null || opts.operator === '')) {
    throw new Error('--write also needs --as <username>, so the audit rows name a real operator.');
  }
  if (opts.write && opts.approvedIds.length === 0) {
    throw new Error(
      '--write also needs --ids <comma-separated ids>, copied from the dry run you read. It is ' +
        'what makes the approved set and the deleted set provably the same.',
    );
  }

  await bootPlatform({ modules: moduleManifests });

  const plan = await planPurge(opts);
  const report = reportOf(plan, opts);

  // BEFORE the first delete, always — and the file list is the only record of which stored objects
  // existed, so it goes in too. A backup that cannot be written aborts the run.
  const backupPath = resolve(
    flag('backup') ?? `applicant-purge-${opts.write ? 'write' : 'dry-run'}.json`,
  );
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(
    backupPath,
    JSON.stringify(
      {
        report,
        documents: await affectedDocuments(
          plan.ids,
          plan.plans,
          plan.portalAccounts,
          plan.files,
          plan.empties,
        ),
      },
      null,
      2,
    ),
    'utf8',
  );

  if (!opts.write) {
    logger.info(
      { ...report, backupPath },
      'applicant purge DRY RUN — nothing was deleted. Read this, then re-run with ' +
        `--write --confirm ${CONFIRMATION} --as <username> --ids ${report.ids.join(',')}`,
    );
    await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
    process.exit(0);
  }

  const ctx = breakGlassContext(await operatorId(opts.operator as string));
  const { filesRemoved, fileFailures } = await execute(plan, opts, ctx, backupPath);

  logger.warn(
    { ...report, backupPath, filesRemoved, fileFailures, operator: opts.operator },
    fileFailures.length > 0
      ? 'BREAK-GLASS: applicants purged, but some files could not be removed — see fileFailures'
      : 'BREAK-GLASS: applicants purged',
  );

  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(fileFailures.length > 0 ? 1 : 0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'applicant purge failed');
  process.exit(1);
});
