// What the deploy writes of one bank's file (Round 29b critic) — pure, for its spec. The import's
// own plan (`planBranchImport`), less the rows nobody may write without looking first.
//
// THE IMPORT SHOWS A PERSON THESE ROWS; THE DEPLOY HOLDS THEM BACK. On «استيراد من شيت» a «جديد» row
// whose name is a held branch's spelt another way is marked (`similarTo`) for the operator to see
// before «تأكيد الاستيراد». The deploy has no one to see it, and a mark nobody reads is a duplicate
// branch for good. So, on a bank that already holds branches, a NEW row is NOT written when it may
// be a branch the bank holds:
//   · `similarName` — its name is a held branch's in another spelling («النزهه» / «النزهة»);
//   · `codeHeld` — its code, one the sheet gives no other row, is a held branch's of another name
//     the sheet does not name: the bank's own code for the branch, already on a branch.
// A code the sheet gives several rows («0» eighteen times on بنك مصر's sheet, the region numbers it
// repeats) names no one branch: its rows take «-2», «-3», … by the import's rule, as on an empty bank.
// The rows held back are listed — the held branch each may be with them — and the rest is planned
// again without them (and without the import's own problem rows, so a name the sheet gives twice
// stays unwritten when its first row is held back). A held-back row's area is created only if
// another written row names it; its code is free for the others. On an empty bank nothing is held
// back: the plan is the import's, row for row.
//
// THE CHANGES ARE KEPT. Every held branch the load edits is listed with what it held before and
// what it holds after — the sheet's area REPLACES a held branch's «منطقة العمليات» and «منطقة
// الحسابات» (the owner's rule: «حدّث الكود والمنطقة»), and the run row is where that can be read
// back without the audit trail.
import {
  type OperationsBranchImportAreaNote,
  type OperationsBranchImportField,
  type OperationsBranchImportProblem,
  type OperationsBranchImportValuesDto,
} from '@ecms/contracts';
import {
  planBranchImport,
  type BranchImportPlan,
  type HeldArea,
  type HeldBranch,
} from '../bank-branches/import/plan-branch-import';
import { sheetRowsOf, type BankBranchesFile } from './bank-branches-banks';

export type BankLoadHeldBackReason = 'similarName' | 'codeHeld';

/** A row of the sheet the deploy does not write: a person adds it, through «استيراد من شيت». */
export interface BankLoadHeldBackRow {
  row: number;
  name: string;
  code: string | null;
  why: BankLoadHeldBackReason;
  /** The held branch the row may be. */
  branch: { id: string; name: string; code: string };
}

/** A held branch the load edits, before and after. */
export interface BankLoadChangedRow {
  row: number;
  branchId: string;
  name: string;
  changes: OperationsBranchImportField[];
  before: OperationsBranchImportValuesDto;
  after: OperationsBranchImportValuesDto;
}

/** A row whose area is not the sheet's own pair (`areaNote`): what was written in its place. */
export interface BankLoadAreaNoteRow {
  row: number;
  note: OperationsBranchImportAreaNote;
  sheetArea: string | null;
  written: string | null;
}

export interface BankLoadPlan {
  /** What is written. */
  plan: BranchImportPlan;
  heldBack: BankLoadHeldBackRow[];
  /** The rows the import itself refuses (a name twice, no code …) — written nothing. */
  problemRows: { row: number; problem: OperationsBranchImportProblem }[];
  changed: BankLoadChangedRow[];
  /** Of `changed`, the held branches whose ops or finance area HAD a value the sheet's replaces. */
  areasReplaced: number;
  areaNotes: BankLoadAreaNoteRow[];
}

const heldBackOf = (
  first: BranchImportPlan,
  file: BankBranchesFile,
  branches: readonly HeldBranch[],
): BankLoadHeldBackRow[] => {
  // How many rows of the sheet give each code — the rows left out (a date for a name) too.
  const rowsOfCode = new Map<string, number>();
  for (const { code } of [...file.rows, ...file.leftOut]) {
    if (code !== null) rowsOfCode.set(code, (rowsOfCode.get(code) ?? 0) + 1);
  }
  const named = new Set(first.rows.flatMap((row) => (row.branchId === null ? [] : [row.branchId])));
  const unnamedByCode = new Map(
    branches.filter((branch) => !named.has(branch.id)).map((branch) => [branch.code, branch]),
  );
  return first.rows.flatMap((row): BankLoadHeldBackRow[] => {
    if (row.outcome !== 'new') return [];
    const base = { row: row.row, name: row.name as string, code: row.sheetCode };
    if (row.similarTo !== null) {
      const { branchId: id, name, code } = row.similarTo;
      return [{ ...base, why: 'similarName', branch: { id, name, code } }];
    }
    const holder =
      row.sheetCode !== null && rowsOfCode.get(row.sheetCode) === 1
        ? unnamedByCode.get(row.sheetCode)
        : undefined;
    if (holder === undefined) return [];
    return [
      { ...base, why: 'codeHeld', branch: { id: holder.id, name: holder.name, code: holder.code } },
    ];
  });
};

/** One bank's file against what the bank and «المناطق» hold — rule above. */
export const planBankLoad = (
  file: BankBranchesFile,
  branches: readonly HeldBranch[],
  areas: readonly HeldArea[],
): BankLoadPlan => {
  const rows = sheetRowsOf(file);
  const first = planBranchImport(rows, branches, areas);
  const problemRows = first.rows.flatMap((row) =>
    row.problem === null ? [] : [{ row: row.row, problem: row.problem }],
  );
  const heldBack = heldBackOf(first, file, branches);
  let plan = first;
  if (heldBack.length > 0) {
    const out = new Set([...heldBack.map(({ row }) => row), ...problemRows.map(({ row }) => row)]);
    plan = planBranchImport(
      rows.filter((row) => !out.has(row.row)),
      branches,
      areas,
    );
  }
  const changed = plan.rows.flatMap((row): BankLoadChangedRow[] =>
    row.outcome !== 'update' || row.branchId === null || row.before === null || row.after === null
      ? []
      : [
          {
            row: row.row,
            branchId: row.branchId,
            name: row.name as string,
            changes: row.changes,
            before: row.before,
            after: row.after,
          },
        ],
  );
  const areasReplaced = changed.filter(
    ({ changes, before }) =>
      (changes.includes('opsAreaName') && before.opsAreaName !== null) ||
      (changes.includes('financeAreaName') && before.financeAreaName !== null),
  ).length;
  const areaNotes = plan.rows.flatMap((row): BankLoadAreaNoteRow[] =>
    row.areaNote === null
      ? []
      : [
          {
            row: row.row,
            note: row.areaNote,
            sheetArea: row.sheetArea.ar ?? row.sheetArea.en,
            written: row.after?.opsAreaName ?? null,
          },
        ],
  );
  return { plan, heldBack, problemRows, changed, areasReplaced, areaNotes };
};
