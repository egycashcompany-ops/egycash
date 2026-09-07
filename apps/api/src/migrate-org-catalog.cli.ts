// Give the company ONE list of departments and ONE list of sections (P-ORG-2) — the operator's
// entrypoint.
//
//   npm run migrate:org-catalog                       # DRY RUN: reads, plans, checks, writes nothing
//   npm run migrate:org-catalog -- --write             # apply it
//   npm run migrate:org-catalog -- --merge A=B         # "A and B are the same department"
//   npm run migrate:org-catalog -- --report out.json   # where the full plan is written
//
// READ THE DRY RUN FIRST. It prints every catalog entry it would create, which branch rows would
// point at each, every merge it was asked for, and every reference that merge would repoint. That
// output IS the plan that `--write` then executes — not a summary of it.
//
// WHAT IT DOES. Groups the department rows by name (the workforce importer's own fold, so this
// cannot disagree with what the importer created), makes ONE catalog entry per group taking the
// oldest member's code and spelling, and points every member at it. Sections the same, one entry
// per (company-wide department, name). Nothing is deleted and nobody moves.
//
// EXCEPT WHERE A HUMAN SAYS SO. `--merge LOSER=WINNER` names two department rows in ONE branch that
// are the same unit — either because their names already fold together (which the new unique index
// cannot allow) or because they are the same department spelled two different ways on purpose. That
// is the only case where rows are repointed and a department is retired, and it never happens
// unless somebody types it. On this deployment the two were:
//
//   npm run migrate:org-catalog -- --merge DEP-0041=CAI-0 --merge OPS-1=DEP-0052
//
// IT REFUSES RATHER THAN HALF-APPLIES. Any problem at all — a merge across branches, two same-named
// departments in one branch that nobody has resolved, a unique index the repointing would violate,
// a notification rule naming a department being merged — and nothing is written. There is no
// partial mode, because a catalog covering some branches and not others is worse than the
// duplication it was fixing.
//
// `HR_PROVISION_MISSING_LOGINS=false` IS REQUIRED TO RUN THIS AT ALL, dry run included. Booting the
// platform runs the HR login backfill, which messages every employee who has no login — before this
// command reads a single row. See `workforce-boot-guard.ts`.
import { writeFile } from 'node:fs/promises';
import { Types } from 'mongoose';
import { logger } from './infrastructure/logging/logger';
import { env } from './infrastructure/config/env';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { userRepository } from './platform/users/user.repository';
import { assertLoginProvisioningDisabled } from './workforce-boot-guard';
import { runOrgCatalogMigration } from './org-catalog-migration/apply';
import { type MergeRequest } from './org-catalog-migration/plan';

const flag = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
};

/** Every `--merge LOSER=WINNER`, in the order they were typed. */
export const parseMerges = (argv: readonly string[]): MergeRequest[] => {
  const out: MergeRequest[] = [];
  argv.forEach((arg, index) => {
    if (arg !== '--merge') return;
    const value = argv[index + 1] ?? '';
    const [loserCode = '', winnerCode = ''] = value.split('=');
    if (loserCode === '' || winnerCode === '') {
      throw new Error(`--merge needs LOSER=WINNER, e.g. --merge DEP-0041=CAI-0 (got "${value}")`);
    }
    out.push({ loserCode: loserCode.toUpperCase(), winnerCode: winnerCode.toUpperCase() });
  });
  return out;
};

/**
 * Who this change is attributed to.
 *
 * `--actor` when given, otherwise the seeded administrator — every row this touches records a
 * person, so a reader asking "who renamed my department?" gets an answer instead of a blank.
 */
const resolveActor = async (): Promise<string | null> => {
  const explicit = flag('actor');
  if (explicit !== null && explicit !== '') {
    if (!Types.ObjectId.isValid(explicit))
      throw new Error(`--actor "${explicit}" is not a user id`);
    return explicit;
  }
  const admin = await userRepository.findOne({ email: env.SEED_ADMIN_EMAIL });
  return admin === null ? null : String(admin._id);
};

const main = async (): Promise<void> => {
  // BEFORE THE BOOT, because the boot is what sends the messages.
  assertLoginProvisioningDisabled('migrate:org-catalog');

  const write = process.argv.includes('--write');
  const merges = parseMerges(process.argv);

  await bootPlatform({ modules: moduleManifests });

  const actorId = await resolveActor();
  if (write && actorId === null) {
    throw new Error(
      'cannot attribute this change to anybody: no --actor was given and no user matches ' +
        `SEED_ADMIN_EMAIL (${env.SEED_ADMIN_EMAIL}). Pass --actor <userId> and run again.`,
    );
  }

  const report = await runOrgCatalogMigration({
    write,
    // A dry run writes nothing, so an unresolvable actor must not stop it from reporting.
    actorId: actorId ?? new Types.ObjectId().toString(),
    merges,
  });

  const reportPath = flag('report') ?? `org-catalog-${write ? 'write' : 'dry-run'}.json`;
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  logger.info(
    {
      departmentEntries: report.plan.departments.length,
      departmentRows: report.plan.departments.reduce((n, e) => n + e.memberIds.length, 0),
      sectionEntries: report.plan.sections.length,
      sectionRows: report.plan.sections.reduce((n, e) => n + e.memberIds.length, 0),
      alreadyLinked: report.plan.alreadyLinked,
      merges: report.plan.merges.map((m) => `${m.loserCode} into ${m.winnerCode}`),
      referencesToRepoint: report.references.map((r) => `${r.collection}.${r.path} x${r.rows}`),
      reportPath,
    },
    'org catalog — what this would do',
  );

  // Printed rather than left in the file: a refusal is the one thing an operator must read, and
  // scrolling a JSON file to find out why nothing happened is how a refusal gets ignored.
  if (report.plan.problems.length > 0) {
    for (const problem of report.plan.problems) logger.error({ problem }, 'org catalog: REFUSED');
    logger.error(
      { problems: report.plan.problems.length },
      'nothing was written. Resolve every problem above, then run again.',
    );
    await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
    process.exit(1);
  }

  if (!write) {
    logger.info('DRY RUN — nothing written. Re-run with --write to apply exactly this plan.');
  } else {
    logger.info(
      { created: report.created, linked: report.linked, merged: report.merged },
      'org catalog: applied',
    );
  }

  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'org catalog migration failed');
  process.exit(1);
});
