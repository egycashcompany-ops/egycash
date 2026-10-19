// Streaming a cursor into a CSV download — the loop the audit, attendance and ATM register exports
// share, written once so it is tested once.
//
// Three ways it ends, and the export audits each of them:
//   - every row written: `completed` is true;
//   - the client left part-way (a write answered false): `completed` is false, with the rows
//     written so far;
//   - the read failed part-way (a cursor the server timed out while a paused client held the
//     download, an election, a row that could not be turned into CSV): `failure` is the error, and
//     the export audits the rows already sent before it rethrows. Without that, pausing a large
//     download past the server's idle-cursor timeout would have been a way to export unaudited.
//
// The cursor is closed in every case: a `break` only stops reading, and the server would otherwise
// keep it open until its own timeout.
import type { DrainingWrite } from './draining-writer';

export interface ClosableCursor<T> extends AsyncIterable<T> {
  close(): Promise<unknown>;
}

export interface StreamedRows {
  rowCount: number;
  completed: boolean;
  /** The error that stopped the read, if one did. */
  failure?: unknown;
}

export const streamRows = async <T>(
  cursor: ClosableCursor<T>,
  write: DrainingWrite,
  toLine: (doc: T) => string,
): Promise<StreamedRows> => {
  let rowCount = 0;
  try {
    for await (const doc of cursor) {
      if (!(await write(toLine(doc)))) return { rowCount, completed: false };
      rowCount += 1;
    }
    return { rowCount, completed: true };
  } catch (failure) {
    return { rowCount, completed: false, failure };
  } finally {
    await cursor.close().catch(() => undefined);
  }
};

/**
 * A HEAD request is answered with the GET handler, and a HEAD response throws its body away while
 * every write reports success: an export would read every row and audit a download that never
 * happened. The exports answer HEAD with their headers alone.
 */
export const isHeadRequest = (res: { req?: { method?: string } }): boolean =>
  res.req?.method === 'HEAD';
