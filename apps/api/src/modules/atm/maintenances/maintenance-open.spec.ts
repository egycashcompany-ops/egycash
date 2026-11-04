// The maintenance batch open's wiring, with the database mocked: the per-line service type and
// reference ride their own line into ONE insert, unknown codes are reported, and the trail is one
// batch. Over real HTTP and a real mongod: tests/integration/atm.spec.ts and
// atm-no-double-open.spec.ts.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuditEntry } from '../../../platform/audit';
import { type AuthContext } from '../../../shared/types';
import type * as AtmContextModule from '../shared/atm-context';
import { type AtmMachineDoc } from '../machines/machine.model';
import { type AtmMaintenanceDoc } from './maintenance.model';

const branchId = vi.hoisted(() => '6a71ba261db68a923e529c11');
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
const { atmMaintenanceService } = await import('./maintenance.service');
const { atmMaintenanceRepository } = await import('./maintenance.repository');
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

describe('atmMaintenanceService.open', () => {
  it('writes every known line in ONE insert with its own service and reference, then one audit batch', async () => {
    const insert = vi
      .spyOn(atmMaintenanceRepository, 'createManyUnordered')
      .mockImplementation(async (docs) => ({
        inserted: docs.map((doc, index) => ({
          index,
          doc: { ...doc, _id: new Types.ObjectId() } as AtmMaintenanceDoc,
        })),
        duplicateIndexes: [],
      }));
    const openedAt = new Date('2026-11-04T08:00:00.000Z');
    const result = await atmMaintenanceService.open(
      {
        rows: [
          { machineCode: '205', serviceType: 'Card reader', referenceNumber: 'REF-1' },
          { machineCode: '777', serviceType: null, referenceNumber: null },
          { machineCode: '101', serviceType: 'Cash dispenser', referenceNumber: null },
        ],
        openedAt,
      },
      ctx,
    );

    expect(insert).toHaveBeenCalledTimes(1);
    const [docs, meta] = insert.mock.calls[0] ?? [];
    expect(meta).toEqual({ by: ctx.userId });
    expect(docs?.map((doc) => [doc.machineCode, doc.serviceType, doc.referenceNumber])).toEqual([
      ['205', 'Card reader', 'REF-1'],
      ['101', 'Cash dispenser', null],
    ]);
    expect(docs?.[0]).toMatchObject({
      openedAt,
      source: 'manual',
      mailTicketId: null,
      notes: null,
      openedByName: 'م. أحمد',
    });
    expect(result.opened.map((row) => row.machineCode)).toEqual(['205', '101']);
    expect(result.unknownCodes).toEqual(['777']);
    expect(result.alreadyOpenCodes).toEqual([]);

    expect(record).not.toHaveBeenCalled();
    expect(recordMany).toHaveBeenCalledTimes(1);
    expect(recordMany.mock.calls[0]?.[0].map((entry) => entry.entityRef)).toEqual(
      result.opened.map((row) => ({
        moduleId: 'atm',
        entityType: 'maintenance',
        entityId: String(row._id),
      })),
    );
  });
});
