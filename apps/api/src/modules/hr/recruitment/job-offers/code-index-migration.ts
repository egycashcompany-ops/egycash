// `ux_code` on `hr_job_offers` drifted away from what the schema declares, and the drift breaks
// hiring on a live database.
//
// WHAT HAPPENED. The index was first built as a plain unique index on `code`. Later the schema
// added `partialFilterExpression: { code: { $type: 'string' } }` — because a `waiting` offer has
// no code yet (I11), and a unique index counts every missing value as one shared `null`. Mongoose
// does NOT rewrite an index that already exists under the same name, so every database created
// before that change still enforces the old shape: the FIRST codeless offer is fine and the SECOND
// fails with `E11000 ... ux_code dup key: { code: null }`.
//
// It surfaces as the backlog materializer refusing to open `waiting` rows — six applicants on a
// real deployment, on every boot, forever, because nothing retries and nothing repairs it.
//
// The decision is separated from the database work so it can be tested: the destructive half is
// one `dropIndex`, and what guards it is the interesting part.

/** The subset of an index descriptor this decision reads. */
export interface CodeIndexInfo {
  name?: string;
  unique?: boolean;
  partialFilterExpression?: unknown;
}

export type CodeIndexVerdict =
  /** Nothing to do — the index is absent, or already carries a partial filter. */
  | { action: 'skip'; why: string }
  /** Drop and let the schema rebuild it. */
  | { action: 'rebuild' }
  /**
   * REFUSE. Dropping a unique index is only safe if the rebuild can succeed; if two live offers
   * share a code, the rebuild fails and the collection is left with NO uniqueness at all — a
   * silently weakened invariant, which is worse than the bug being fixed.
   */
  | { action: 'blocked'; duplicates: string[] };

/**
 * @param existing the `ux_code` descriptor as the database reports it, or undefined if absent
 * @param duplicateCodes live offer codes held by more than one document
 */
export const decideCodeIndexRebuild = (
  existing: CodeIndexInfo | undefined,
  duplicateCodes: readonly string[],
): CodeIndexVerdict => {
  if (existing === undefined) {
    // A fresh install: `createIndexes` builds the declared shape, nothing to migrate.
    return { action: 'skip', why: 'no ux_code index exists yet' };
  }
  if (existing.partialFilterExpression !== undefined) {
    return { action: 'skip', why: 'ux_code already carries a partial filter' };
  }
  if (duplicateCodes.length > 0) {
    return { action: 'blocked', duplicates: [...duplicateCodes] };
  }
  return { action: 'rebuild' };
};
