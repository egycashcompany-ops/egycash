// The export loop: every way it ends is reported, and the cursor is closed in each.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { isHeadRequest, streamRows, type ClosableCursor } from './stream-rows';

/** A cursor over `rows` that counts what was read, optionally failing at row `failAt`. */
const cursorOver = (rows: number, failAt?: number) => {
  const state = { read: 0 };
  const close = vi.fn().mockResolvedValue(undefined);
  async function* generate(): AsyncGenerator<number> {
    for (let i = 0; i < rows; i += 1) {
      if (i === failAt) throw Object.assign(new Error('cursor id 42 not found'), { code: 43 });
      state.read += 1;
      yield i;
    }
  }
  const cursor: ClosableCursor<number> = Object.assign(generate(), { close });
  return { cursor, close, state };
};

describe('streaming a cursor into a download', () => {
  it('writes every row and says it completed', async () => {
    const { cursor, close } = cursorOver(5);
    const lines: string[] = [];
    const outcome = await streamRows(
      cursor,
      async (chunk) => {
        lines.push(chunk);
        return true;
      },
      (n) => `${String(n)}\n`,
    );
    expect(outcome).toEqual({ rowCount: 5, completed: true });
    expect(lines).toEqual(['0\n', '1\n', '2\n', '3\n', '4\n']);
    expect(close).toHaveBeenCalledOnce();
  });

  it('stops reading when the client leaves, and says it did not complete', async () => {
    const { cursor, close, state } = cursorOver(1_000);
    let writes = 0;
    const outcome = await streamRows(
      cursor,
      async () => {
        writes += 1;
        return writes <= 10;
      },
      String,
    );
    expect(outcome).toEqual({ rowCount: 10, completed: false });
    // Row eleven was the write that found the client gone; nothing past it was read.
    expect(state.read).toBe(11);
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports a read that fails part-way with the rows already sent, instead of throwing past them', async () => {
    const { cursor, close } = cursorOver(100, 30);
    const outcome = await streamRows(cursor, async () => true, String);
    expect(outcome.rowCount).toBe(30);
    expect(outcome.completed).toBe(false);
    expect((outcome.failure as { code?: number }).code).toBe(43);
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports a row that cannot be written as CSV the same way', async () => {
    const { cursor, close } = cursorOver(10);
    const outcome = await streamRows(
      cursor,
      async () => true,
      (n) => {
        if (n === 4) throw new Error('malformed row');
        return String(n);
      },
    );
    expect(outcome.rowCount).toBe(4);
    expect(outcome.failure).toBeInstanceOf(Error);
    expect(close).toHaveBeenCalledOnce();
  });

  it('still returns when closing the cursor fails', async () => {
    const { cursor, close } = cursorOver(3);
    close.mockRejectedValueOnce(new Error('connection closed'));
    await expect(streamRows(cursor, async () => true, String)).resolves.toEqual({
      rowCount: 3,
      completed: true,
    });
  });
});

describe('a HEAD request', () => {
  it('is told apart from a GET', () => {
    expect(isHeadRequest({ req: { method: 'HEAD' } })).toBe(true);
    expect(isHeadRequest({ req: { method: 'GET' } })).toBe(false);
    expect(isHeadRequest({})).toBe(false);
  });
});

describe('the streamed exports', () => {
  // The audit export has its own behavioural spec; the ATM register export has none, so this holds
  // both to the shared loop that is tested above.
  //
  // THE ATTENDANCE EXPORT LEFT THIS LIST on 18 November, and not by being excused. It stopped
  // being a query over day documents: it resolves each date through the same service call the
  // screens make, so there is no cursor for `streamRows` to read. The properties that list was
  // really protecting still hold of it and are asserted separately below, and it now has the
  // behavioural spec it lacked — `hr-attendance.spec.ts` takes a real export apart cell by cell,
  // which is a stronger guard than any of these string matches.
  const src = join(dirname(fileURLToPath(import.meta.url)), '../..');
  it.each(['platform/audit/audit.export.ts', 'modules/atm/register/register-export.ts'])(
    '%s reads its cursor through streamRows, audits every outcome and answers HEAD alone',
    (file) => {
      const code = readFileSync(join(src, file), 'utf8');
      expect(code).toContain('outcome = await streamRows(cursor, write,');
      expect(code).not.toMatch(/for await \(const \w+ of cursor\)/);
      expect(code).toContain("{ field: 'completed', old: null, new: outcome.completed }");
      expect(code).toContain('if (outcome.failure !== undefined) throw outcome.failure;');
      // The HEAD answer comes before the writer is made, so no cursor is ever opened for it.
      const head = code.indexOf('if (isHeadRequest(res))');
      expect(head).toBeGreaterThan(-1);
      expect(head).toBeLessThan(code.indexOf('drainingWriter(res)'));
    },
  );

  describe('the attendance export, which resolves instead of reading a cursor', () => {
    const code = (): string =>
      readFileSync(join(src, 'modules/hr/attendance/day-records/attendance-export.ts'), 'utf8');

    it('answers HEAD before it makes a writer, so it resolves nothing for one', () => {
      const file = code();
      const head = file.indexOf('if (isHeadRequest(res))');
      expect(head).toBeGreaterThan(-1);
      expect(head).toBeLessThan(file.indexOf('drainingWriter(res)'));
    });

    it('audits how the download ended, and rethrows only after the row has landed', () => {
      const file = code();
      // The audit is owed whether or not the read succeeded — somebody asked for this file.
      expect(file).toContain("{ field: 'completed', old: null, new: completed }");
      expect(file).toContain("{ field: 'rowCount', old: null, new: rowCount }");
      const audited = file.indexOf('await auditService.record(');
      const rethrown = file.indexOf('if (failure !== undefined) throw failure;');
      expect(audited).toBeGreaterThan(-1);
      expect(rethrown).toBeGreaterThan(audited);
    });

    it('stops reading the moment the client goes, like the cursor-based exports do', () => {
      // `drainingWriter` answers false when the socket has gone. A loop that ignored it would keep
      // resolving branch-days for a download nobody is receiving.
      expect(code()).toMatch(/if \(!\(await write\(csvRow\(reportCells\(row, locale\)\)\)\)\)/);
    });

    it('RESOLVES ONE DATE AT A TIME over a range — the memory property the cursor used to give', () => {
      const file = code();
      // A 92-day sheet export must never hold 92 days of rows at once: a day of the sheet resolves
      // every employed person on it. The per-date loop is what keeps it to one branch-day.
      expect(file).toContain('for (const date of datesBetween(from, to))');
      expect(file).toContain('const rows = await sheetRowsFor(date, query, scope, query.sortBy)');
    });
  });
});
