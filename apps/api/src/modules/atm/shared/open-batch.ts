// A batch open's write — the one both `open`s (replenishment, maintenance) share once their lines
// are decided. Production measured the open at 1.2 s (replenishment) and up to 2.3 s (maintenance):
// one insert AND one queued audit per line, in series, so a pasted list of fifty machines waited for
// a hundred round trips. Here it is one insert and one queue add, whatever the length of the list.
import { auditService, type AuditEntry } from '../../../platform/audit';
import { PartialCreateError, type CreateManyResult } from '../../../shared/base/base.repository';

/** One line the open will write: the machine code the request named, and the row it becomes. */
export interface OpenLine<T> {
  /** The line's code as the request sent it, normalized — what the trail and the answer name. */
  code: string;
  doc: Partial<T>;
}

/**
 * Write every line in ONE unordered insert (`write` — the repository's `createManyUnordered`),
 * record one audit entry per row that landed (`auditOf`), and answer with the rows opened — in the
 * lines' order, as the per-line loop opened them — and the codes a unique index refused.
 *
 * A refused line is REPORTED, not failed (`alreadyOpenCodes`): nothing of it was written, and the
 * rest of the batch stands — what the per-line loop answered a refused line while the
 * one-open-per-day rule held a unique index (OD-1, lifted by OD-1b/OD-1c). Neither log carries such
 * an index any more, so this is empty unless a database still has one the boot failed to drop.
 *
 * Any other failure is thrown, as before — but only AFTER the rows that landed anyway are audited:
 * the insert is unordered, so they are in the log whatever the request answers, and a row nobody
 * recorded opening is exactly what the audit trail exists to rule out.
 */
export const insertOpenLines = async <T>(
  lines: readonly OpenLine<T>[],
  write: (docs: Partial<T>[]) => Promise<CreateManyResult<T>>,
  auditOf: (doc: T, line: OpenLine<T>) => AuditEntry,
): Promise<{ opened: T[]; alreadyOpenCodes: string[] }> => {
  let result: CreateManyResult<T>;
  let failure: { error: unknown } | null = null;
  try {
    result = await write(lines.map((line) => line.doc));
  } catch (error) {
    if (!(error instanceof PartialCreateError)) throw error;
    result = error.result as CreateManyResult<T>;
    failure = { error: error.cause };
  }
  const lineAt = (index: number): OpenLine<T> => lines[index] as OpenLine<T>;
  await auditService.recordMany(
    result.inserted.map(({ index, doc }) => auditOf(doc, lineAt(index))),
  );
  if (failure !== null) throw failure.error;
  return {
    opened: result.inserted.map(({ doc }) => doc),
    alreadyOpenCodes: result.duplicateIndexes.map((index) => lineAt(index).code),
  };
};
