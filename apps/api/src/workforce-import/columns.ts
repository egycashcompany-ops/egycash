// Binding the workbook's columns to names, and refusing to guess.
//
// THE TRAP THIS EXISTS TO CLOSE. Both sheets carry the same header twice: `جهة الحصول` at Master
// columns 30 and 33, `تاريخ المؤهل` at 31 and 34 — the first pair belongs to the primary
// qualification, the second to an additional one. The Resignation sheet repeats `c 6` as well. The
// obvious way to read a spreadsheet — build a map from header text to column index — silently keeps
// the LAST of each pair, which means every primary qualification's institution (1,256 values) and
// year (1,651 values) is replaced by a field that is filled for 1.3% of employees. Nothing errors.
// The import simply completes with the wrong data in a way no reviewer would see.
//
// So a column is addressed by `(header, nth occurrence)`, never by header alone, and the layout is
// asserted whole before a single row is read: if the workbook does not have the shape this importer
// was written against, the run stops rather than mapping columns onto the wrong meanings.

/** Where a named column lives: its header text and which occurrence of that header it is. */
export interface ColumnRef {
  header: string;
  /** 0-based. `0` is the first column with this header, `1` the second. */
  occurrence: number;
}

export const at = (header: string, occurrence = 0): ColumnRef => ({ header, occurrence });

/**
 * Resolve every named column to a 0-based index against a header row.
 *
 * Returns the index map, or the list of columns that could not be bound — never a partial map with
 * silent holes, because a hole reads as "this employee had no national ID" rather than "this
 * importer could not find the national ID column".
 */
export const bindColumns = <K extends string>(
  headers: readonly (string | null)[],
  spec: Record<K, ColumnRef>,
): { columns: Record<K, number> } | { missing: string[] } => {
  const seen = new Map<string, number[]>();
  headers.forEach((raw, index) => {
    if (raw === null) return;
    const key = normalizeHeader(raw);
    if (key === '') return;
    const list = seen.get(key);
    if (list === undefined) seen.set(key, [index]);
    else list.push(index);
  });

  const columns = {} as Record<K, number>;
  const missing: string[] = [];
  for (const [name, ref] of Object.entries(spec) as [K, ColumnRef][]) {
    const positions = seen.get(normalizeHeader(ref.header)) ?? [];
    const index = positions[ref.occurrence];
    if (index === undefined) {
      missing.push(
        ref.occurrence === 0
          ? `${name} ("${ref.header}")`
          : `${name} ("${ref.header}" #${String(ref.occurrence + 1)})`,
      );
      continue;
    }
    columns[name] = index;
  }
  return missing.length > 0 ? { missing } : { columns };
};

/**
 * Headers are compared loosely — whitespace collapsed, bidi marks stripped, Arabic letter forms
 * unified — because the same header is typed inconsistently across the two sheets (`c 6` vs `c6`,
 * `الرقم التاميني` with and without the hamza). Loose on the HEADER only; cell values keep their
 * own, stricter rules in `cell.ts`.
 */
export const normalizeHeader = (raw: string): string =>
  raw
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu, '')
    .replace(/[إأآا]/gu, 'ا')
    .replace(/[ىي]/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .replace(/\s+/gu, '')
    .trim()
    .toLowerCase();

/**
 * A cheap, whole-layout assertion: the ordered list of headers, joined.
 *
 * Checked before any row is read. A workbook whose columns moved — an inserted column, a renamed
 * header, a sheet exported from a different version of the file — produces a different fingerprint
 * and the run refuses to start. Without it, an inserted column shifts every subsequent field by one
 * and the import writes national IDs into the address field, at scale, silently.
 */
export const fingerprint = (headers: readonly (string | null)[]): string =>
  headers.map((h) => (h === null ? '' : normalizeHeader(h))).join('|');
