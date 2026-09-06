// Read-only diagnosis of the org-unit duplication — «الإدارات والأقسام والوظائف مكررة».
//
//   npm run report:org-duplication
//   npm run report:org-duplication -- --json > report.json
//
// IT WRITES NOTHING. It connects to Mongo and reads; it does NOT boot the platform, deliberately,
// because booting runs the seeds and the migrations, and a tool whose whole job is to describe the
// database as it stands must not change it first. Every operation below is a find or an aggregate.
//
// WHY IT EXISTS. The redesign of departments and sections turns on five facts that cannot be read
// out of the source. Three of them are gates, not curiosities:
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
//
// Grouping uses `orgKey` — the SAME Arabic folding the importer matched with, so this report
// groups things exactly the way the importer decided they were the same. That matters: a report
// that folded differently would describe a duplication nobody created.
import { connectMongo, disconnectMongo } from './infrastructure/database/mongo';
import { logger } from './infrastructure/logging/logger';
import {
  collisionsWithinOneBranch,
  groupByFoldedName,
  type NameGroup,
} from './org-duplication-report/grouping';
import { BranchModel } from './platform/organization/branches/branch.model';
import { DepartmentModel } from './platform/organization/departments/department.model';
import { SectionModel } from './platform/organization/sections/section.model';
import { JobTitleModel } from './platform/organization/job-titles/job-title.model';

/** Collections that carry a department but whose branch is nullable — the ⑤ gate. */
const NULLABLE_BRANCH_COLLECTIONS = [
  'hr_payslips',
  'hr_employee_loans',
  'hr_payroll_adjustments',
  'hr_employee_pay_items',
  'hr_leave_requests',
] as const;

const live = { isDeleted: false } as const;

const run = async (): Promise<Record<string, unknown>> => {
  const [branches, departments, sections, jobTitles] = await Promise.all([
    BranchModel.find(live).select({ _id: 1, code: 1, name: 1 }).lean().exec(),
    DepartmentModel.find(live).select({ _id: 1, code: 1, name: 1, branchId: 1 }).lean().exec(),
    SectionModel.find(live).select({ _id: 1, code: 1, name: 1, departmentId: 1, branchId: 1 }).lean().exec(),
    JobTitleModel.find(live).select({ _id: 1, code: 1, name: 1 }).lean().exec(),
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

  // ④ Sections, grouped by (parent department, folded name) — the importer's own key.
  const sectionsByParentAndName = new Map<string, number>();
  for (const parentId of new Set(sections.map((row) => String(row.departmentId)))) {
    const under = sections.filter((row) => String(row.departmentId) === parentId);
    for (const group of groupByFoldedName(under)) {
      sectionsByParentAndName.set(`${parentId}|${group.key}`, group.count);
    }
  }
  const sectionGroups = groupByFoldedName(sections);
  const sectionDuplicates = sectionGroups.filter((g) => g.count > 1);

  // ⑤ Rows carrying a department but no branch — already invisible to a branch-scoped reader,
  //    and the reason a "department AND branch" scope filter would not be the no-op it looks like.
  const connection = SectionModel.db;
  const orphanedByCollection: Record<string, number> = {};
  for (const name of NULLABLE_BRANCH_COLLECTIONS) {
    orphanedByCollection[name] = await connection
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
    sectionsSharingParentAndName: [...sectionsByParentAndName.values()].filter((n) => n > 1).length,
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
  lines.push(`─── ④ sections repeated: ${secDup.length} names, ${r.sectionsSharingParentAndName as number} sharing a parent too ───`);
  for (const g of secDup.slice(0, 25)) {
    lines.push(`  ${g.count}×  ${g.names.join(' / ')}`);
  }
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

const main = async (): Promise<void> => {
  const asJson = process.argv.includes('--json');
  await connectMongo();
  try {
    const report = await run();
    // stdout, not the logger, so `--json > file` and a piped read both work.
    process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : `${humanReport(report)}\n`);
  } finally {
    await disconnectMongo();
  }
};

main().catch((error: unknown) => {
  logger.error({ err: error }, 'org duplication report failed');
  process.exitCode = 1;
});
