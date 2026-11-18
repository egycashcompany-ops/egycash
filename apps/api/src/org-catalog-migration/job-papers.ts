// «مستندات الوظائف» follow their department when it is linked (P-ORG-3 follow-up).
//
// The job papers keep a department's lines under the key `catalogId ?? row id`
// (`job-papers.service.ts` keyOf, `person-papers.ts` departmentKeyOf). While a department is not
// linked to the company list that key is its ROW id — one line set per branch copy, each shown as
// its own department in the popup. Linking gives the row a catalog entry, and from then on its lines
// are read under the ENTRY id: a line left under the row id is never read again, and the papers HR
// set for that job fall back to what the templates give it, without a word. So the migration moves
// the lines with the department.
//
// Several branch copies of one department become one company department, so two copies can each
// carry a line for the same job. Where those lines say the same thing one is kept and the rest are
// retired. Where they DIFFER, the one saved last is kept — the most recent decision HR made about
// that job in that department — and the dry run names every such case, so the operator reads which
// line wins before typing `--write`.
//
// Pure, like `plan.ts`: the I/O half reads the lines and the rows and writes what this decides.

/** One saved line, as this planner needs to see it. */
export interface PaperLine {
  id: string;
  /** The key it is stored under today: a department row id, or a catalog entry id. */
  departmentId: string;
  jobTitleId: string;
  added: readonly string[];
  removed: readonly string[];
  /** ISO string — the line saved last wins a disagreement. */
  updatedAt: string;
}

/** A line that disagreed with another line for the same job in the same company department. */
export interface PaperConflict {
  /** Where the department's lines will live: `id:<entry id>` or `fold:<planned entry's key>`. */
  target: string;
  jobTitleId: string;
  kept: string;
  dropped: string[];
}

export interface PaperPlan {
  /** Lines re-keyed from a row id to their department's entry. */
  moves: { lineId: string; target: string }[];
  /** Lines retired because another line for the same job in the same department is kept. */
  drops: { lineId: string; keptLineId: string; sameAsKept: boolean }[];
  conflicts: PaperConflict[];
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((key) => set.has(key));
};

/**
 * Decide where every line goes.
 *
 * `targetOf(departmentId)` says where a stored key's lines belong once the migration has run:
 * `id:<entry>` for a row already linked, a row joining an existing entry, or an entry id itself;
 * `fold:<key>` for a row joining an entry this run creates; null for anything else (a retired row,
 * an unknown id) — those lines are left exactly as they are.
 */
export const planPaperMoves = (
  lines: readonly PaperLine[],
  targetOf: (departmentId: string) => string | null,
): PaperPlan => {
  const groups = new Map<string, { target: string; lines: PaperLine[] }>();
  for (const line of lines) {
    const target = targetOf(line.departmentId.toLowerCase());
    if (target === null) continue;
    const key = `${target}|${line.jobTitleId.toLowerCase()}`;
    const group = groups.get(key) ?? { target, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }

  const plan: PaperPlan = { moves: [], drops: [], conflicts: [] };
  for (const { target, lines: group } of groups.values()) {
    const atTarget = (line: PaperLine): boolean => target === `id:${line.departmentId.toLowerCase()}`;
    // The line saved last; on a tie, the one already where it belongs, then the lowest id — so the
    // dry run and the write always pick the same line.
    const ordered = [...group].sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        Number(atTarget(b)) - Number(atTarget(a)) ||
        a.id.localeCompare(b.id),
    );
    const kept = ordered[0] as PaperLine;
    if (!atTarget(kept)) plan.moves.push({ lineId: kept.id, target });
    const rest = ordered.slice(1);
    const differing: string[] = [];
    for (const line of rest) {
      const sameAsKept = sameSet(line.added, kept.added) && sameSet(line.removed, kept.removed);
      plan.drops.push({ lineId: line.id, keptLineId: kept.id, sameAsKept });
      if (!sameAsKept) differing.push(line.id);
    }
    if (differing.length > 0) {
      plan.conflicts.push({ target, jobTitleId: kept.jobTitleId, kept: kept.id, dropped: differing });
    }
  }
  return plan;
};
