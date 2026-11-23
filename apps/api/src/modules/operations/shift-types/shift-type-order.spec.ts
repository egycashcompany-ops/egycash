// «أنواع التشغيل» (Round 20) — the catalog's order and its seed list, pinned without a database.
// The twin of currencies/currency-order.spec.ts: the types are dragged the way the currencies are.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPERATIONS_SHIFT_TYPE_COLOURS } from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { operationsShiftTypeRepository } from './shift-type.repository';
import {
  LEGACY_SHIFT_TYPES,
  byShiftTypeOrder,
  operationsShiftTypeService,
} from './shift-type.service';
import { type OperationsShiftTypeDoc } from './shift-type.model';

afterEach(() => vi.restoreAllMocks());

const type = (name: string, sortOrder: number | null): OperationsShiftTypeDoc =>
  ({
    _id: new Types.ObjectId(),
    name,
    nameEn: null,
    colour: 'rose',
    seedKey: null,
    isActive: true,
    sortOrder,
  }) as unknown as OperationsShiftTypeDoc;

describe('the shift-type catalog’s order', () => {
  it('reads placed types first, then the Arabic name', () => {
    const placed = type('مسائي', 0);
    const a = type('أسوان', null);
    const b = type('يومي', null);
    expect([b, a, placed].sort(byShiftTypeOrder)).toEqual([placed, a, b]);
    // A row written with no place at all reads as unplaced.
    const legacy = {
      ...type('سفر', null),
      sortOrder: undefined,
    } as unknown as OperationsShiftTypeDoc;
    expect([legacy, placed].sort(byShiftTypeOrder)).toEqual([placed, legacy]);
  });

  it('writes the dragged order and keeps the types not named after them in their old order', async () => {
    const [a, b, c] = [type('يومي', 0), type('سفر', 1), type('مسائي', 2)];
    vi.spyOn(operationsShiftTypeRepository, 'listAll').mockResolvedValue([c!, b!, a!]);
    const written = vi.spyOn(operationsShiftTypeRepository, 'writeOrder').mockResolvedValue();
    const audited = vi.spyOn(auditService, 'record').mockResolvedValue();
    await operationsShiftTypeService.order(
      { ids: [String(c!._id)] },
      new Types.ObjectId().toString(),
    );
    expect(written.mock.calls[0]?.[0].map(String)).toEqual([c, a, b].map((x) => String(x!._id)));
    expect(audited.mock.calls[0]?.[0].changes).toEqual([
      { field: 'order', old: ['يومي', 'سفر', 'مسائي'], new: ['مسائي', 'يومي', 'سفر'] },
    ]);
  });

  it('refuses an id that is not a type of the catalog, and writes nothing', async () => {
    vi.spyOn(operationsShiftTypeRepository, 'listAll').mockResolvedValue([type('يومي', 0)]);
    const written = vi.spyOn(operationsShiftTypeRepository, 'writeOrder').mockResolvedValue();
    await expect(
      operationsShiftTypeService.order(
        { ids: [new Types.ObjectId().toString()] },
        new Types.ObjectId().toString(),
      ),
    ).rejects.toMatchObject({ httpStatus: 409 });
    expect(written).not.toHaveBeenCalled();
  });
});

describe('the legacy nine the boot seeds', () => {
  it('are the legacy board’s list, in its order, each with a key, an English name and a palette colour', () => {
    expect(LEGACY_SHIFT_TYPES.map((t) => t.name)).toEqual([
      'يومي',
      'احتياطي',
      'احتياطي سفر',
      'أسوان',
      'إيباج',
      'سفر',
      'شلاتين',
      'محصنة',
      'مسائي',
    ]);
    expect(new Set(LEGACY_SHIFT_TYPES.map((t) => t.key)).size).toBe(9);
    for (const seed of LEGACY_SHIFT_TYPES) {
      expect(seed.nameEn).not.toBe('');
      expect(OPERATIONS_SHIFT_TYPE_COLOURS).toContain(seed.colour);
    }
  });
});
