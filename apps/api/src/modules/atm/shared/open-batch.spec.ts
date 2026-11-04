// A batch open's write (`insertOpenLines`): the answer and the trail it leaves, given what the one
// insert reports. The insert itself is `createManyUnordered` (shared/base, its own spec); the real
// opens over HTTP and a real mongod are tests/integration/atm-no-double-open.spec.ts.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuditEntry } from '../../../platform/audit';
import { PartialCreateError, type CreateManyResult } from '../../../shared/base/base.repository';

const recordMany = vi.hoisted(() => vi.fn(async (_entries: readonly AuditEntry[]) => undefined));
vi.mock('../../../platform/audit', () => ({ auditService: { recordMany } }));

const { insertOpenLines } = await import('./open-batch');

interface Row {
  _id: Types.ObjectId;
  machineCode: string;
}

const line = (code: string) => ({ code, doc: { machineCode: code } as Partial<Row> });
const stored = (code: string): Row => ({ _id: new Types.ObjectId(), machineCode: code });
const auditOf = (doc: Row, l: { code: string }): AuditEntry => ({
  entityRef: { moduleId: 'atm', entityType: 'replenishment', entityId: String(doc._id) },
  action: 'create',
  changes: [{ field: 'machineCode', old: null, new: l.code }],
});

beforeEach(() => {
  recordMany.mockClear();
});

describe('insertOpenLines', () => {
  it('writes every line at once, answers in the lines’ order, and audits each row in one call', async () => {
    const rows = [stored('101'), stored('101'), stored('205')];
    const write = vi.fn(async (): Promise<CreateManyResult<Row>> => ({
      inserted: rows.map((doc, index) => ({ index, doc })),
      duplicateIndexes: [],
    }));
    const lines = [line('101'), line('101'), line('205')];
    const result = await insertOpenLines(lines, write, auditOf);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(lines.map((l) => l.doc));
    expect(result).toEqual({ opened: rows, alreadyOpenCodes: [] });
    expect(recordMany).toHaveBeenCalledTimes(1);
    expect(recordMany.mock.calls[0]?.[0]).toEqual(rows.map((doc, i) => auditOf(doc, lines[i]!)));
  });

  it('reports a line a unique index refused — by ITS code — and audits only what landed', async () => {
    const landed = [stored('101'), stored('303')];
    const result = await insertOpenLines(
      [line('101'), line('205'), line('303')],
      async () => ({
        inserted: [
          { index: 0, doc: landed[0]! },
          { index: 2, doc: landed[1]! },
        ],
        duplicateIndexes: [1],
      }),
      auditOf,
    );
    expect(result).toEqual({ opened: landed, alreadyOpenCodes: ['205'] });
    // Each audit row names the code of ITS line — the index, not the position among the landed.
    expect(recordMany.mock.calls[0]?.[0].map((entry) => entry.changes?.[0]?.new)).toEqual([
      '101',
      '303',
    ]);
  });

  it('a failure part-way: the rows that landed are audited FIRST, then the original error is thrown', async () => {
    const cause = new Error('write failed');
    const landed = stored('101');
    const write = async (): Promise<CreateManyResult<Row>> => {
      throw new PartialCreateError<Row>(
        { inserted: [{ index: 0, doc: landed }], duplicateIndexes: [] },
        cause,
      );
    };
    await expect(insertOpenLines([line('101'), line('205')], write, auditOf)).rejects.toBe(cause);
    expect(recordMany).toHaveBeenCalledTimes(1);
    expect(recordMany.mock.calls[0]?.[0]).toEqual([auditOf(landed, line('101'))]);
  });

  it('a failure that names no row is thrown untouched, and nothing is audited', async () => {
    const dropped = new Error('connection reset');
    await expect(
      insertOpenLines(
        [line('101')],
        async () => {
          throw dropped;
        },
        auditOf,
      ),
    ).rejects.toBe(dropped);
    expect(recordMany).not.toHaveBeenCalled();
  });

  it('no lines: nothing opened, an empty trail', async () => {
    const write = vi.fn(async () => ({ inserted: [], duplicateIndexes: [] }));
    expect(await insertOpenLines<Row>([], write, auditOf)).toEqual({
      opened: [],
      alreadyOpenCodes: [],
    });
    expect(recordMany).toHaveBeenCalledWith([]);
  });
});
