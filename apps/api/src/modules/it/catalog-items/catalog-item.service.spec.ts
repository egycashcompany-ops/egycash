// The catalog's «يتطلب عداد الطباعة» (design §2.4) — the owner, 19 November 2026: a flag on the
// consumable TYPE, ticked on «حبارات», that makes each of its items be issued with the printer's
// counter reading.
//
// With the data layer mocked, what is pinned is what the service decides: the flag is written as
// the contract parsed it on a create, ticked only on a consumable type on an update (the update
// body cannot see the kind, so this is the server's refusal) and unticked on any row, audited in
// the row's snapshot — and a row written before the flag reads false, both in the audit and in the
// answer. The HTTP edge, the 422 and the real rows are `tests/integration/it-module.spec.ts`.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateItCatalogItemSchema, UpdateItCatalogItemSchema } from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { toItCatalogItemDto } from '../it.mappers';
import { type ItCatalogItemDoc } from './catalog-item.model';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  findByKindAndNameAr: vi.fn(),
  create: vi.fn(),
  getById: vi.fn(),
  updateById: vi.fn(),
}));

vi.mock('../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('./catalog-item.repository', () => ({
  itCatalogItemRepository: {
    findByKindAndNameAr: mocks.findByKindAndNameAr,
    create: mocks.create,
    getById: mocks.getById,
    updateById: mocks.updateById,
  },
}));

const { itCatalogItemService } = await import('./catalog-item.service');

const BY = String(new Types.ObjectId());
const AT = new Date('2026-11-19T09:00:00.000Z');

/** A catalog row; `legacy` drops the flag's key, as a row written before 2026-11-19 has none. */
const row = (over: Partial<ItCatalogItemDoc> = {}, legacy = false): ItCatalogItemDoc => {
  const doc: ItCatalogItemDoc = {
    _id: new Types.ObjectId(),
    kind: 'consumableType',
    code: 'ink',
    name: { ar: 'حبارات', en: 'Ink & toner' },
    description: null,
    sortOrder: 10,
    isActive: true,
    requiresCounterReading: false,
    schemaVersion: 1,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdBy: null,
    updatedBy: null,
    createdAt: AT,
    updatedAt: AT,
    __v: 0,
    ...over,
  };
  if (legacy) delete (doc as Partial<ItCatalogItemDoc>).requiresCounterReading;
  return doc;
};

const auditedChanges = () =>
  (mocks.audit.mock.calls[0]?.[0] as { changes: { field: string; old: unknown; new: unknown }[] })
    .changes;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findByKindAndNameAr.mockResolvedValue(null);
  mocks.audit.mockResolvedValue(undefined);
});

describe('creating a catalog row with the printer counter', () => {
  it('writes the flag as the contract parsed it, and audits it with the row', async () => {
    const input = CreateItCatalogItemSchema.parse({
      kind: 'consumableType',
      name: { ar: 'أحبار ملونة', en: 'Colour toner' },
      requiresCounterReading: true,
    });
    mocks.create.mockImplementation(async (data: Partial<ItCatalogItemDoc>) => row(data));

    const doc = await itCatalogItemService.create(input, BY);

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'consumableType', requiresCounterReading: true }),
      { by: BY },
    );
    expect(doc.requiresCounterReading).toBe(true);
    expect(auditedChanges()).toContainEqual({
      field: 'requiresCounterReading',
      old: null,
      new: true,
    });
  });

  it('writes false when the form sends nothing — every kind, the contract’s default', async () => {
    const input = CreateItCatalogItemSchema.parse({
      kind: 'assetCategory',
      name: { ar: 'طابعات', en: 'Printers' },
    });
    mocks.create.mockImplementation(async (data: Partial<ItCatalogItemDoc>) => row(data));

    await itCatalogItemService.create(input, BY);

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ requiresCounterReading: false }),
      { by: BY },
    );
  });
});

describe('ticking and unticking it on an existing row', () => {
  it('ticks a consumable type — and a row from before the flag audits false → true', async () => {
    const before = row({}, true);
    mocks.getById.mockResolvedValue(before);
    mocks.updateById.mockResolvedValue(row({ _id: before._id, requiresCounterReading: true }));

    const input = UpdateItCatalogItemSchema.parse({ requiresCounterReading: true, version: 0 });
    const doc = await itCatalogItemService.update(String(before._id), input, BY);

    expect(mocks.updateById).toHaveBeenCalledWith(
      String(before._id),
      { requiresCounterReading: true },
      { by: BY, version: 0 },
    );
    expect(doc.requiresCounterReading).toBe(true);
    expect(auditedChanges()).toEqual([{ field: 'requiresCounterReading', old: false, new: true }]);
  });

  it.each(['assetCategory', 'ticketCategory'] as const)(
    'refuses to tick a %s — 422, nothing written, nothing audited',
    async (kind) => {
      const before = row({ kind, code: null, name: { ar: 'طابعات', en: 'Printers' } });
      mocks.getById.mockResolvedValue(before);

      const input = UpdateItCatalogItemSchema.parse({ requiresCounterReading: true, version: 0 });
      const refusal = itCatalogItemService.update(String(before._id), input, BY);

      await expect(refusal).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(refusal).rejects.toMatchObject({
        httpStatus: 422,
        code: 'BUSINESS_RULE_VIOLATION',
        message: 'only a consumableType takes the printer counter',
      });
      expect(mocks.updateById).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );

  it('unticks any row, whatever its kind — taking the flag off is never refused', async () => {
    const before = row({ kind: 'assetCategory', code: null }, true);
    mocks.getById.mockResolvedValue(before);
    mocks.updateById.mockResolvedValue(before);

    const input = UpdateItCatalogItemSchema.parse({ requiresCounterReading: false, version: 0 });
    await itCatalogItemService.update(String(before._id), input, BY);

    expect(mocks.updateById).toHaveBeenCalledWith(
      String(before._id),
      { requiresCounterReading: false },
      { by: BY, version: 0 },
    );
    // A row from before the flag already read false: its audit row names no change.
    expect(auditedChanges()).toEqual([]);
  });

  it('leaves the flag alone when the body does not name it', async () => {
    const before = row({ requiresCounterReading: true });
    mocks.getById.mockResolvedValue(before);
    mocks.updateById.mockResolvedValue({ ...before, sortOrder: 20 });

    const input = UpdateItCatalogItemSchema.parse({ sortOrder: 20, version: 0 });
    await itCatalogItemService.update(String(before._id), input, BY);

    expect(mocks.updateById).toHaveBeenCalledWith(
      String(before._id),
      { sortOrder: 20 },
      { by: BY, version: 0 },
    );
    expect(auditedChanges()).toEqual([{ field: 'sortOrder', old: 10, new: 20 }]);
  });
});

describe('the catalog row as the screens read it', () => {
  it('answers the flag as stored', () => {
    expect(toItCatalogItemDto(row({ requiresCounterReading: true })).requiresCounterReading).toBe(
      true,
    );
  });

  it('answers false for a row written before the flag — a lean read applies no default', () => {
    expect(toItCatalogItemDto(row({}, true))).toMatchObject({
      kind: 'consumableType',
      requiresCounterReading: false,
    });
  });
});
