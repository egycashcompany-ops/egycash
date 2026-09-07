// Read-only diagnosis of the org-unit duplication — «الإدارات والأقسام والوظائف مكررة».
//
//   npm run report:org-duplication -- --uri "mongodb://…"
//   npm run report:org-duplication -- --uri "mongodb://…" --json > org-report.json
//
// The URI may also come from MONGO_URI in the environment. `--uri` exists because this tool is
// pointed at a database that is usually NOT the one the developer's `.env` describes, and making
// somebody edit `.env` to read their own production numbers is friction with a sharp edge: it
// leaves a live connection string on disk after the one question it answered.
//
// IT WRITES NOTHING, and it deliberately depends on almost nothing.
//
// It does not boot the platform: `bootPlatform` runs the seeds and the migrations, and a tool whose
// whole job is to describe the database as it stands must not change it first.
//
// It does not import the Mongoose MODELS either, and that is not fastidiousness — importing
// `department.model` re-opens a real import cycle (model → `shared/org-unit` → `audit.service` →
// auth → users → the department repository → back into the model while its schema helpers are
// still initializing) and the entrypoint dies with a TDZ `ReferenceError` before its first line of
// logic. The application's own entry order happens to avoid that cycle; a CLI entering the graph
// at a model does not. `org-unit.ts` carries a comment about the same cycle from a previous
// encounter with it.
//
// So the whole runtime dependency is mongoose and the collection names below, which
// `collections.spec.ts` pins against what the models actually declare. A read-only report that
// depends on nothing cannot be broken by anything.
//
// WHY IT EXISTS. The redesign of departments and sections turns on five facts that cannot be read
// out of source, and three of them are gates rather than curiosities:
//
//   ② decides whether the new per-branch uniqueness rule can be applied at all. If one branch
//     already holds two departments whose names fold together, the index cannot be created until
//     somebody resolves that pair by hand — and finding that out during the migration means
//     stopping half-finished.
//   ③ settles the third part of the complaint. Job titles carry no branch and the importer keys
//     them by name alone, so the MODEL cannot produce per-branch copies — but nothing enforces
//     name uniqueness either (`ux_code` constrains the code; `assertNameAvailable` is implemented
//     by exactly one service, branches), so two identical titles can be created by hand. Only a
//     query can close this.
//   ⑤ is a standing defect worth knowing about whatever is decided. `branchId` is nullable on
//     payslips, loans, adjustments, pay items and leave requests, and the only backfill that ever
//     ran fills `departmentId` and never touches `branchId`. Any row with a department but no
//     branch is already invisible to a branch-scoped reader.
import mongoose from 'mongoose';
import {
  collisionsWithinOneBranch,
  groupByFoldedName,
  type NameGroup,
} from './org-duplication-report/grouping';
import { ORG_COLLECTIONS, NULLABLE_BRANCH_COLLECTIONS } from './org-duplication-report/collections';

/** The shape this report reads. Raw driver documents, not hydrated models. */
interface UnitRow {
  _id: unknown;
  code: string;
  name: { ar: string; en: string };
  branchId?: unknown;
  departmentId?: unknown;
}

const live = { isDeleted: false } as const;

const readUnits = async (collection: string): Promise<UnitRow[]> =>
  mongoose.connection
    .collection(collection)
    .find(live, { projection: { _id: 1, code: 1, name: 1, branchId: 1, departmentId: 1 } })
    .toArray() as unknown as Promise<UnitRow[]>;

const run = async (): Promise<Record<string, unknown>> => {
  const [branches, departments, sections, jobTitles] = await Promise.all([
    readUnits(ORG_COLLECTIONS.branches),
    readUnits(ORG_COLLECTIONS.departments),
    readUnits(ORG_COLLECTIONS.sections),
    readUnits(ORG_COLLECTIONS.jobTitles),
  ]);
  const branchName = new Map(branches.map((b) => [String(b._id), b.name.ar]));

  // ① How much of the department count is repetition, and how much is real?
  const departmentGroups = groupByFoldedName(departments);
  const departmentDuplicates = departmentGroups.filter((g) => g.count > 1);

  // ② THE BLOCKING ONE. Two departments in the SAME branch whose names fold together cannot both
  //    survive a `{branchId, catalogId}` unique index. Nothing today forbids this.
  const collisions = collisionsWithinOneBranch(
    departments.map((d) => ({ code: d.code, name: d.name, branchId: String(d.branchId) })),
  ).map((c) => ({ ...c, branch: branchName.get(c.branchId) ?? c.branchId }));

  // ③ Are any job titles actually duplicated? The model cannot cause it; a human can.
  const jobTitleDuplicates = groupByFoldedName(jobTitles).filter((g) => g.count > 1);

  // ④ Sections, grouped by the importer's own key: (parent department, folded name).
  const sectionsSharingParentAndName = [...new Set(sections.map((s) => String(s.departmentId)))]
    .flatMap((parentId) =>
      groupByFoldedName(sections.filter((s) => String(s.departmentId) === parentId)),
    )
    .filter((g) => g.count > 1).length;
  const sectionGroups = groupByFoldedName(sections);
  const sectionDuplicates = sectionGroups.filter((g) => g.count > 1);

  // ⑤ Rows carrying a department but no branch — already invisible to a branch-scoped reader,
  //    and the reason a "department AND branch" scope filter would not be the no-op it looks like.
  const orphanedByCollection: Record<string, number> = {};
  for (const name of NULLABLE_BRANCH_COLLECTIONS) {
    orphanedByCollection[name] = await mongoose.connection
      .collection(name)
      .countDocuments({ departmentId: { $ne: null }, branchId: null });
  }

  return {
    totals: {
      branches: branches.length,
      departments: departments.length,
      distinctDepartmentNames: departmentGroups.length,
      sections: sections.length,
      distinctSectionNames: sectionGroups.length,
      jobTitles: jobTitles.length,
    },
    departmentDuplicates,
    collisionsWithinOneBranch: collisions,
    jobTitleDuplicates,
    sectionDuplicates,
    sectionsSharingParentAndName,
    orphanedByCollection,
  };
};

const humanReport = (r: Record<string, unknown>): string => {
  const t = r.totals as Record<string, number>;
  const depDup = r.departmentDuplicates as NameGroup[];
  const secDup = r.sectionDuplicates as NameGroup[];
  const titleDup = r.jobTitleDuplicates as NameGroup[];
  const collisions = r.collisionsWithinOneBranch as { branch: string; foldedName: string; codes: string[] }[];
  const orphans = r.orphanedByCollection as Record<string, number>;
  const lines: string[] = [];

  lines.push('─── totals ───');
  lines.push(`  branches      ${t.branches}`);
  lines.push(`  departments   ${t.departments}  →  ${t.distinctDepartmentNames} distinct names`);
  lines.push(`  sections      ${t.sections}  →  ${t.distinctSectionNames} distinct names`);
  lines.push(`  job titles    ${t.jobTitles}`);

  lines.push('');
  lines.push(`─── ① departments repeated across branches: ${depDup.length} names ───`);
  for (const g of depDup.slice(0, 25)) {
    lines.push(`  ${g.count}×  ${g.names.join(' / ')}   [${g.codes.join(', ')}]`);
  }
  if (depDup.length > 25) lines.push(`  … and ${depDup.length - 25} more`);

  lines.push('');
  lines.push(`─── ② GATE — two departments folding together INSIDE one branch: ${collisions.length} ───`);
  if (collisions.length === 0) {
    lines.push('  none. The per-branch uniqueness rule can be applied as-is.');
  } else {
    lines.push('  These must be resolved by hand BEFORE the new index can be created:');
    for (const c of collisions) lines.push(`  · ${c.branch} — «${c.foldedName}» [${c.codes.join(', ')}]`);
  }

  lines.push('');
  lines.push(`─── ③ job titles sharing a folded name: ${titleDup.length} ───`);
  if (titleDup.length === 0) {
    lines.push('  none. Job titles are already one company-wide list — nothing to change there.');
  } else {
    for (const g of titleDup) lines.push(`  ${g.count}×  ${g.names.join(' / ')}   [${g.codes.join(', ')}]`);
  }

  lines.push('');
  lines.push(
    `─── ④ sections repeated: ${secDup.length} names, ${r.sectionsSharingParentAndName as number} sharing a parent too ───`,
  );
  for (const g of secDup.slice(0, 25)) lines.push(`  ${g.count}×  ${g.names.join(' / ')}`);
  if (secDup.length > 25) lines.push(`  … and ${secDup.length - 25} more`);

  lines.push('');
  lines.push('─── ⑤ rows carrying a department but NO branch ───');
  const totalOrphans = Object.values(orphans).reduce((a, b) => a + b, 0);
  for (const [name, n] of Object.entries(orphans)) lines.push(`  ${String(n).padStart(6)}  ${name}`);
  lines.push(
    totalOrphans === 0
      ? '  none — every department-bearing row also names its branch.'
      : `  ${totalOrphans} rows are ALREADY invisible to a branch-scoped reader. Worth fixing regardless.`,
  );

  return lines.join('\n');
};

/** `--uri <value>` or `--uri=<value>`, else MONGO_URI. */
const resolveUri = (argv: readonly string[]): string => {
  const flag = argv.indexOf('--uri');
  if (flag !== -1 && argv[flag + 1] !== undefined) return String(argv[flag + 1]);
  const inline = argv.find((a) => a.startsWith('--uri='));
  if (inline !== undefined) return inline.slice('--uri='.length);
  return process.env.MONGO_URI ?? '';
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const uri = resolveUri(argv).trim();
  if (uri === '') {
    // A named instruction, not a schema dump: this tool needs exactly one thing.
    process.stderr.write(
      'No database to read.\n' +
        '  Pass it:  npm run report:org-duplication -- --uri "mongodb://…"\n' +
        '  or set MONGO_URI in the environment.\n',
    );
    process.exitCode = 1;
    return;
  }
  await mongoose.connect(uri);
  try {
    const report = await run();
    // stdout, so `--json > file` and a pipe both work; diagnostics go to stderr.
    process.stdout.write(
      argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : `${humanReport(report)}\n`,
    );
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`org duplication report failed: ${String(error)}\n`);
  process.exitCode = 1;
});
