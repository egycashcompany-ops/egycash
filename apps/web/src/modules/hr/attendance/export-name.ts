// What an attendance export is CALLED once it is on somebody's disk.
//
// Its own module because three screens save the same kind of file — the daily sheet, an employee's
// month in HR, and an employee's own page — and a folder of them is only readable if they agree on
// the rule. It is pure, so `export-name.spec.ts` can hold it to the owner's wording.
import type { Locale, OrgUnitOptionDto } from '@ecms/contracts';

/**
 * WHAT THE SAVED FILE IS CALLED — the owner's rule: `attendance-2026-11-18.csv`, a range as
 * `attendance-2026-11-01_2026-11-18.csv`, and a name appended to say WHICH slice of the company it
 * is: the branch when exactly one branch is filtered, or the employee's code on their own page.
 *
 * It is built on the CLIENT because the client is what knows which branch the reader picked and in
 * which language they are reading; the server's `Content-Disposition` names the dates alone as a
 * fallback. Exported, and pure, so the naming rule is a test rather than a claim.
 *
 * `label` is reduced to what a file system accepts everywhere: separators, the characters Windows
 * refuses, and runs of whitespace all become single hyphens. Arabic letters are KEPT — the
 * branches are named in Arabic, and «attendance-2026-11-18-المهندسين.csv» is exactly what makes a
 * folder of these files readable at a glance.
 */
export const exportFileName = (from: string, to: string, label?: string | undefined): string => {
  const span = from === to ? from : `${from}_${to}`;
  const suffix =
    label === undefined || label === ''
      ? ''
      : `-${label
          .replace(/[\\/:*?"<>|]/g, ' ')
          .trim()
          .replace(/\s+/g, '-')}`;
  return `attendance-${span}${suffix}.csv`;
};

/** The branch's name when exactly one is filtered — what the file is named after. */
export const soleBranchName = (
  branchIds: readonly string[],
  branches: readonly OrgUnitOptionDto[] | undefined,
  locale: Locale,
): string | undefined =>
  branchIds.length === 1
    ? branches?.find((branch) => branch.id === branchIds[0])?.name[locale]
    : undefined;
