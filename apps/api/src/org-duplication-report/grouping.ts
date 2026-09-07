// The pure half of the org-duplication report: how rows are judged to be "the same unit".
//
// Split out from the CLI because this is the only part that can be WRONG in a way nobody notices.
// A report that folded names differently from the importer would describe a duplication nobody
// created — and the whole point of the report is to size a duplication the importer did create.
// So the folding is `orgKey` itself, the importer's own function, and these tests pin the specific
// spelling pairs its comment names.
import { orgKey } from '../workforce-import/vocabulary';

export interface NamedUnit {
  code: string;
  name: { ar: string };
}

export interface NameGroup {
  /** The folded key these rows share. */
  key: string;
  /** Every distinct spelling that folded to it — a merge proposal, in the company's own words. */
  names: string[];
  count: number;
  codes: string[];
}

/** Fold `name.ar` with the importer's key and group by it, commonest first. */
export const groupByFoldedName = (rows: readonly NamedUnit[]): NameGroup[] => {
  const byKey = new Map<string, NameGroup>();
  for (const row of rows) {
    // A name `orgKey` cannot fold (empty, punctuation only) is its own group rather than being
    // silently merged with every other unfoldable name.
    const key = orgKey(row.name.ar) ?? row.name.ar;
    const hit = byKey.get(key);
    if (hit === undefined) {
      byKey.set(key, { key, names: [row.name.ar], count: 1, codes: [row.code] });
      continue;
    }
    hit.count += 1;
    hit.codes.push(row.code);
    if (!hit.names.includes(row.name.ar)) hit.names.push(row.name.ar);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};

export interface BranchCollision {
  branchId: string;
  foldedName: string;
  codes: string[];
}

/**
 * Two units that fold together INSIDE one branch — the gate on the whole redesign.
 *
 * A `{branchId, catalogId}` unique index cannot be created while such a pair exists, and nothing
 * today forbids one: the only unique index on these collections is on `code`, and two rows in one
 * branch can perfectly well be «الرقابة والمستهلكات» and «الرقابة و المستهلكات».
 */
export const collisionsWithinOneBranch = (
  rows: readonly (NamedUnit & { branchId: string })[],
): BranchCollision[] => {
  const perBranch = new Map<string, Map<string, string[]>>();
  for (const row of rows) {
    const key = orgKey(row.name.ar) ?? row.name.ar;
    const inBranch = perBranch.get(row.branchId) ?? new Map<string, string[]>();
    inBranch.set(key, [...(inBranch.get(key) ?? []), row.code]);
    perBranch.set(row.branchId, inBranch);
  }
  return [...perBranch.entries()].flatMap(([branchId, keys]) =>
    [...keys.entries()]
      .filter(([, codes]) => codes.length > 1)
      .map(([foldedName, codes]) => ({ branchId, foldedName, codes })),
  );
};
