// What the org-catalog migration WOULD do, decided without touching the database (P-ORG-2).
//
// Split out from the I/O half because this is the part that can be wrong in a way nobody notices.
// The grouping decides which of seven «العمليات» rows become one company-wide department, and a
// fold that disagreed with the importer's would propose merging units the importer never made a
// copy of. So the folding is `orgKey` itself — the importer's own function — and the plan is a
// value a test can read, not a sequence of writes a test would have to watch.
//
// THE PLAN REFUSES RATHER THAN GUESSES. Every condition it cannot resolve becomes a `problem`, and
// a plan with problems is not written. There is no partial mode: a migration that stopped halfway
// through linking would leave the catalog describing some branches and not others, which is worse
// than the duplication it was fixing.
import { orgKey } from '../workforce-import/vocabulary';

/** A department or section row, as this planner needs to see it. */
export interface UnitRow {
  id: string;
  code: string;
  name: { ar: string; en: string };
  /** The branch the row belongs to. */
  branchId: string;
  /** Sections only: the department row the section hangs under. */
  departmentId?: string;
  /** Already linked by a previous run — such a row is left exactly as it is. */
  catalogId?: string | null;
  /** ISO string. The oldest live member of a group is the one whose code and spelling win. */
  createdAt: string;
}

/**
 * "These two rows are the same unit" — a human decision this migration cannot derive.
 *
 * Two kinds of pair need one. A pair whose names already fold together inside ONE branch cannot
 * both survive the new `{branchId, catalogId}` index, so somebody must say which is real. And a
 * pair spelled differently on purpose folds APART and would become two catalog entries unless
 * somebody says otherwise. Both arrive here as codes, because a code is what the owner reads on
 * their own screen.
 */
export interface MergeRequest {
  loserCode: string;
  winnerCode: string;
}

export interface PlannedCatalogEntry {
  /** The code the catalog entry takes — its oldest live member's. Nothing is invented. */
  code: string;
  name: { ar: string; en: string };
  foldedKey: string;
  /** Ids of the rows that will point at this entry. */
  memberIds: string[];
  /** Member codes, for the report a human reads before typing `--write`. */
  memberCodes: string[];
  /** Sections only: the folded key of the department entry this one belongs to. */
  parentKey?: string;
}

export interface PlannedMerge {
  loserId: string;
  loserCode: string;
  loserName: string;
  winnerId: string;
  winnerCode: string;
  winnerName: string;
  branchId: string;
  /** Section rows that move from the loser to the winner. */
  movedSectionIds: string[];
}

export interface CatalogPlan {
  departments: PlannedCatalogEntry[];
  sections: PlannedCatalogEntry[];
  merges: PlannedMerge[];
  /** Rows a previous run already linked — counted, never touched again. */
  alreadyLinked: { departments: number; sections: number };
  /** Anything that makes the plan unsafe. A non-empty list means nothing is written. */
  problems: string[];
}

/**
 * The folded key a unit groups under — the importer's own `orgKey`, never a second fold.
 *
 * Exported because the I/O half has to look an existing catalog entry up by the same key a plan
 * computed; two folds that disagreed would create a duplicate entry on the second run.
 */
export const foldUnitName = (row: { name: { ar: string } }): string =>
  orgKey(row.name.ar) ?? row.name.ar;

const fold = foldUnitName;

/** Oldest first, then by code, so the winner of a group never depends on read order. */
const oldestFirst = (a: UnitRow, b: UnitRow): number =>
  a.createdAt.localeCompare(b.createdAt) || a.code.localeCompare(b.code);

const groupBy = <T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const row of rows) out.set(key(row), [...(out.get(key(row)) ?? []), row]);
  return out;
};

/**
 * Resolve the merge requests against the rows, refusing every pair that does not make sense.
 *
 * A merge only ever happens INSIDE one branch. Merging across branches would move employees from
 * one site to another, which is a transfer — a personnel action with a date and an approver, not
 * something a catalog migration may do as a side effect.
 */
const planMerges = (
  departments: readonly UnitRow[],
  sections: readonly UnitRow[],
  requests: readonly MergeRequest[],
  problems: string[],
): PlannedMerge[] => {
  const byCode = new Map(departments.map((row) => [row.code, row]));
  const merges: PlannedMerge[] = [];
  const seenLosers = new Set<string>();

  for (const request of requests) {
    const loser = byCode.get(request.loserCode);
    const winner = byCode.get(request.winnerCode);
    if (loser === undefined || winner === undefined) {
      problems.push(
        `merge ${request.loserCode} into ${request.winnerCode}: ` +
          `${loser === undefined ? request.loserCode : request.winnerCode} is not a live department`,
      );
      continue;
    }
    if (loser.id === winner.id) {
      problems.push(`merge ${request.loserCode} into ${request.winnerCode}: same department`);
      continue;
    }
    if (loser.branchId !== winner.branchId) {
      problems.push(
        `merge ${request.loserCode} into ${request.winnerCode}: different branches ` +
          `(${loser.branchId} vs ${winner.branchId}). Moving people between sites is a transfer, ` +
          'not a migration.',
      );
      continue;
    }
    // A chain (A into B, B into C) would have to be applied in an order this planner does not
    // establish, and the middle unit would be both a survivor and a casualty.
    if (seenLosers.has(loser.id) || requests.some((r) => r.loserCode === request.winnerCode)) {
      problems.push(
        `merge ${request.loserCode} into ${request.winnerCode}: chained or repeated merges are ` +
          'refused — name one surviving department per merge.',
      );
      continue;
    }
    seenLosers.add(loser.id);

    // Sections come with their department. Two that fold together under the new parent would be
    // the same duplication one level down, so the move is refused rather than half-done.
    const moving = sections.filter((row) => row.departmentId === loser.id);
    const staying = sections.filter((row) => row.departmentId === winner.id);
    const stayingKeys = new Set(staying.map(fold));
    for (const section of moving) {
      if (stayingKeys.has(fold(section))) {
        problems.push(
          `merge ${request.loserCode} into ${request.winnerCode}: section ${section.code} ` +
            `(${section.name.ar}) already exists under ${request.winnerCode}. ` +
            'Merge the sections first.',
        );
      }
    }

    merges.push({
      loserId: loser.id,
      loserCode: loser.code,
      loserName: loser.name.ar,
      winnerId: winner.id,
      winnerCode: winner.code,
      winnerName: winner.name.ar,
      branchId: loser.branchId,
      movedSectionIds: moving.map((row) => row.id),
    });
  }
  return merges;
};

/**
 * The whole plan.
 *
 * `departments` and `sections` are the LIVE rows — soft-deleted ones are none of this migration's
 * business. Rows that already carry a `catalogId` are counted and skipped, which is what makes a
 * second run a no-op rather than a second catalog.
 */
export const planOrgCatalog = (
  departments: readonly UnitRow[],
  sections: readonly UnitRow[],
  requests: readonly MergeRequest[] = [],
): CatalogPlan => {
  const problems: string[] = [];
  const merges = planMerges(departments, sections, requests, problems);

  const losers = new Set(merges.map((m) => m.loserId));
  const movedTo = new Map<string, string>();
  for (const merge of merges) {
    for (const id of merge.movedSectionIds) movedTo.set(id, merge.winnerId);
  }

  const linkedDepartments = departments.filter((row) => row.catalogId != null);
  const linkedSections = sections.filter((row) => row.catalogId != null);
  const openDepartments = departments.filter((row) => row.catalogId == null && !losers.has(row.id));
  // A section whose department is disappearing follows it; one already linked is left alone.
  const openSections = sections
    .filter((row) => row.catalogId == null)
    .map((row) =>
      movedTo.has(row.id) ? { ...row, departmentId: movedTo.get(row.id) as string } : row,
    );

  // ── Departments: one entry per folded name, across every branch ───────────
  const departmentGroups = groupBy(openDepartments, fold);
  const departmentEntries: PlannedCatalogEntry[] = [];
  const departmentKeyById = new Map<string, string>();
  for (const [key, rows] of departmentGroups) {
    const ordered = [...rows].sort(oldestFirst);
    const oldest = ordered[0] as UnitRow;

    // THE GATE. Two rows in one branch folding together cannot both point at one catalog entry —
    // the unique index refuses it — and this migration will not pick a winner on its own.
    for (const [branchId, inBranch] of groupBy(ordered, (row) => row.branchId)) {
      if (inBranch.length > 1) {
        problems.push(
          `branch ${branchId} holds ${String(inBranch.length)} departments that are the same ` +
            `name (${key}): ${inBranch.map((r) => r.code).join(', ')}. ` +
            'Say which one survives (a merge), then run again.',
        );
      }
    }
    for (const row of ordered) departmentKeyById.set(row.id, key);
    departmentEntries.push({
      code: oldest.code,
      name: oldest.name,
      foldedKey: key,
      memberIds: ordered.map((row) => row.id),
      memberCodes: ordered.map((row) => row.code),
    });
  }

  // A LINKED department is the re-run case: the loser's sections move onto a department that is
  // already catalogued, so its key must still resolve even though nothing new is created for it.
  for (const row of linkedDepartments) departmentKeyById.set(row.id, fold(row));

  // ── Sections: one entry per (company-wide department, folded name) ────────
  //
  // Grouped through a NESTED map rather than one joined composite key: a folded Arabic name keeps
  // its spaces, so any separator that reads naturally would also occur inside the keys being joined.
  const sectionEntries: PlannedCatalogEntry[] = [];
  const orphans = openSections.filter((row) => !departmentKeyById.has(row.departmentId ?? ''));
  for (const [departmentId, rows] of groupBy(orphans, (row) => row.departmentId ?? '')) {
    problems.push(
      `sections ${rows.map((r) => r.code).join(', ')} hang under a department that is not live ` +
        `(${departmentId}). Fix the section's department, then run again.`,
    );
  }
  const placed = openSections.filter((row) => departmentKeyById.has(row.departmentId ?? ''));
  for (const [parentKey, underParent] of groupBy(
    placed,
    (row) => departmentKeyById.get(row.departmentId ?? '') as string,
  )) {
    for (const [key, rows] of groupBy(underParent, fold)) {
      const ordered = [...rows].sort(oldestFirst);
      const oldest = ordered[0] as UnitRow;
      for (const [departmentId, inDepartment] of groupBy(
        ordered,
        (row) => row.departmentId ?? '',
      )) {
        if (inDepartment.length > 1) {
          problems.push(
            `department ${departmentId} holds ${String(inDepartment.length)} sections that are ` +
              `the same name (${key}): ${inDepartment.map((r) => r.code).join(', ')}. ` +
              'Merge them by hand, then run again.',
          );
        }
      }
      sectionEntries.push({
        code: oldest.code,
        name: oldest.name,
        foldedKey: key,
        parentKey,
        memberIds: ordered.map((row) => row.id),
        memberCodes: ordered.map((row) => row.code),
      });
    }
  }

  const byReach = (a: PlannedCatalogEntry, b: PlannedCatalogEntry): number =>
    b.memberIds.length - a.memberIds.length || a.code.localeCompare(b.code);

  return {
    departments: departmentEntries.sort(byReach),
    sections: sectionEntries.sort(byReach),
    merges,
    alreadyLinked: { departments: linkedDepartments.length, sections: linkedSections.length },
    problems,
  };
};
