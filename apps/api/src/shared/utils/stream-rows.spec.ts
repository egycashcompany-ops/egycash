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
  // The audit export has its own behavioural spec; the attendance and ATM register exports have
  // none, so this holds all three to the shared loop that is tested above.
  const src = join(dirname(fileURLToPath(import.meta.url)), '../..');
  it.each([
    'platform/audit/audit.export.ts',
    'modules/hr/attendance/day-records/attendance-export.ts',
    'modules/atm/register/register-export.ts',
  ])(
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
});
