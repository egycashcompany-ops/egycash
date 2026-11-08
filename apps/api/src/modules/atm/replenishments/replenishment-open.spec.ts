// The batch open's wiring, with the database mocked: every known line goes to ONE insert, in the
// order it was pasted, an empty line opens nothing and an unknown code is reported; the trail is one
// batch naming each row's own code. Over real HTTP and a real mongod: tests/integration/atm.spec.ts
// and atm-no-double-open.spec.ts.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuditEntry } from '../../../platform/audit';
import { type AuthContext } from '../../../shared/types';
import type * as AtmContextModule from '../shared/atm-context';
import { type AtmMachineDoc } from '../machines/machine.model';
import { type AtmReplenishmentDoc } from './replenishment.model';

const branchId = vi.hoisted(() => '6a71ba261db68a923e529c10');
const recordMany = vi.hoisted(() => vi.fn(async (_entries: readonly AuditEntry[]) => undefined));
const record = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../../platform/audit', () => ({ auditService: { record, recordMany } }));
vi.mock('../branch-links/move-fence', () => ({
  assertNoBranchMoveRunning: vi.fn(async () => undefined),
}));
vi.mock('../shared/atm-context', async (importOriginal) => ({
  ...(await importOriginal<typeof AtmContextModule>()),
  resolveAtmBranchId: vi.fn(async () => branchId),
}));

// The real audit service first, as the app loads it (see mail-ticket-reject.spec.ts).
await import('../../../platform/audit/audit.service');
const { atmReplenishmentService } = await import('./replenishment.service');
const { atmReplenishmentRepository } = await import('./replenishment.repository');
const { atmMachineRepository } = await import('../machines/machine.repository');

const ctx = {
  userId: String(new Types.ObjectId()),
  identity: { displayName: { ar: 'م. أحمد', en: 'Ahmed' }, jobTitle: null, avatarFileId: null },
} as unknown as AuthContext;

const machine = (code: string) =>
  ({
    _id: new Types.ObjectId(),
    machineCode: code,
    bankName: 'NBE',
    name: `ATM ${code}`,
    zone: 'Z',
    area: 'Smouha',
  }) as unknown as AtmMachineDoc;

/** The insert answers with every row written, as stored — `_id` added, nothing refused. */
const insertAll = () =>
  vi.spyOn(atmReplenishmentRepository, 'createManyUnordered').mockImplementation(async (docs) => ({
    inserted: docs.map((doc, index) => ({
      index,
      doc: { ...doc, _id: new Types.ObjectId() } as AtmReplenishmentDoc,
    })),
    duplicateIndexes: [],
  }));

beforeEach(() => {
  recordMany.mockClear();
  record.mockClear();
  vi.spyOn(atmMachineRepository, 'findActiveByCodes').mockResolvedValue(
    new Map([
      ['101', machine('101')],
      ['205', machine('205')],
    ]),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('atmReplenishmentService.open', () => {
  it('writes every known line in ONE insert, in the pasted order, and audits them in one batch', async () => {
    const insert = insertAll();
    const result = await atmReplenishmentService.open(
      {
        rows: [
          { machineCode: '101', scheduleTime: '10:00' },
          { machineCode: '9999', scheduleTime: null },
          { machineCode: '205', scheduleTime: null },
          { machineCode: '101', scheduleTime: '12:00' },
        ],
        forceDate: null,
      },
      ctx,
    );

    expect(insert).toHaveBeenCalledTimes(1);
    const [docs, meta] = insert.mock.calls[0] ?? [];
    expect(meta).toEqual({ by: ctx.userId });
    expect(docs?.map((doc) => [doc.machineCode, doc.scheduleTime])).toEqual([
      ['101', '10:00'],
      ['205', null],
      ['101', '12:00'],
    ]);
    expect(docs?.[0]).toMatchObject({
      branchId: new Types.ObjectId(branchId),
      bankName: 'NBE',
      machineName: 'ATM 101',
      area: 'Smouha',
      closedAt: null,
      leaderName: null,
      openedById: new Types.ObjectId(ctx.userId),
      openedByName: 'م. أحمد',
    });

    expect(result.opened.map((row) => row.machineCode)).toEqual(['101', '205', '101']);
    expect(result.unknownCodes).toEqual(['9999']);
    expect(result.alreadyOpenCodes).toEqual([]);

    expect(record).not.toHaveBeenCalled();
    expect(recordMany).toHaveBeenCalledTimes(1);
    const trail = recordMany.mock.calls[0]?.[0] ?? [];
    expect(trail.map((entry) => entry.entityRef.entityId)).toEqual(
      result.opened.map((row) => String(row._id)),
    );
    expect(trail[0]).toMatchObject({
      entityRef: { moduleId: 'atm', entityType: 'replenishment' },
      action: 'create',
    });
    expect(trail[0]?.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'machineCode', new: '101' })]),
    );
  });

  it('a line a unique index refused is reported by its code, the rest opened', async () => {
    vi.spyOn(atmReplenishmentRepository, 'createManyUnordered').mockImplementation(
      async (docs) => ({
        inserted: [
          { index: 0, doc: { ...docs[0], _id: new Types.ObjectId() } as AtmReplenishmentDoc },
        ],
        duplicateIndexes: [1],
      }),
    );
    const result = await atmReplenishmentService.open(
      {
        rows: [
          { machineCode: '101', scheduleTime: null },
          { machineCode: '205', scheduleTime: null },
        ],
        forceDate: null,
      },
      ctx,
    );
    expect(result.opened.map((row) => row.machineCode)).toEqual(['101']);
    expect(result.alreadyOpenCodes).toEqual(['205']);
    expect(recordMany.mock.calls[0]?.[0]).toHaveLength(1);
  });
});
