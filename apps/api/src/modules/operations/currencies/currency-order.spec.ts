// «اعملى فى شاشة البيانات المرجعية ان اقدر اعدل زى شاشة الحركة بالظبط» — the currencies are dragged
// into order like Fleet's catalogs (fleet/catalogs/catalog-order.spec.ts is this spec's twin).
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditService } from '../../../platform/audit';
import { operationsCurrencyRepository } from './currency.repository';
import { byCatalogOrder, operationsCurrencyService } from './currency.service';
import { type OperationsCurrencyDoc } from './currency.model';

afterEach(() => vi.restoreAllMocks());

const currency = (code: string, sortOrder: number | null, name = code): OperationsCurrencyDoc =>
  ({
    _id: new Types.ObjectId(),
    code,
    name,
    legacyAliases: [],
    isActive: true,
    sortOrder,
  }) as unknown as OperationsCurrencyDoc;

describe('the currency catalog’s order', () => {
  it('reads placed currencies first, then the code numerically, then the name', () => {
    const placed = currency('USD', 0);
    const ten = currency('10', null);
    const two = currency('2', null);
    const egp = currency('EGP', null);
    const unplacedLater = [ten, egp, two].sort(byCatalogOrder);
    // '2' before '10' — a person's reading, not the text order that puts '10' first.
    expect(unplacedLater.map((c) => c.code)).toEqual(['2', '10', 'EGP']);
    expect([egp, ten, placed].sort(byCatalogOrder)[0]).toBe(placed);
    // A row written before the field existed has none at all — it reads as unplaced.
    const legacy = {
      ...currency('AAA', null),
      sortOrder: undefined,
    } as unknown as OperationsCurrencyDoc;
    expect([legacy, placed].sort(byCatalogOrder)).toEqual([placed, legacy]);
  });

  it('writes the dragged order, and keeps the currencies not named after them in their old order', async () => {
    const [a, b, c, d] = [
      currency('EGP', 0),
      currency('USD', 1),
      currency('EUR', 2),
      currency('SAR', 3),
    ];
    vi.spyOn(operationsCurrencyRepository, 'listAll').mockResolvedValue([d!, c!, b!, a!]);
    const written = vi.spyOn(operationsCurrencyRepository, 'writeOrder').mockResolvedValue();
    const audited = vi.spyOn(auditService, 'record').mockResolvedValue();
    // The screen showed only EUR and EGP (a search), with EUR dragged above EGP.
    await operationsCurrencyService.order(
      { ids: [String(c!._id), String(a!._id)] },
      new Types.ObjectId().toString(),
    );
    expect(written.mock.calls[0]?.[0].map(String)).toEqual([c, a, b, d].map((x) => String(x!._id)));
    expect(audited.mock.calls[0]?.[0].changes).toEqual([
      { field: 'order', old: ['EGP', 'USD', 'EUR', 'SAR'], new: ['EUR', 'EGP', 'USD', 'SAR'] },
    ]);
  });

  it('refuses an id that is not a currency of the catalog, and writes nothing', async () => {
    vi.spyOn(operationsCurrencyRepository, 'listAll').mockResolvedValue([currency('EGP', 0)]);
    const written = vi.spyOn(operationsCurrencyRepository, 'writeOrder').mockResolvedValue();
    await expect(
      operationsCurrencyService.order(
        { ids: [new Types.ObjectId().toString()] },
        new Types.ObjectId().toString(),
      ),
    ).rejects.toMatchObject({ httpStatus: 409 });
    expect(written).not.toHaveBeenCalled();
  });
});
