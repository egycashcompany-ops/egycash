// «قوائم الحركه كل قايمه العناصر اللى فيها اقدر ارتبهم عن طريق الشد والترك».
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditService } from '../../../platform/audit';
import { fleetCatalogItemRepository } from './catalog-item.repository';
import { fleetCatalogItemService } from './catalog-item.service';
import { type FleetCatalogItemDoc } from './catalog-item.model';

afterEach(() => vi.restoreAllMocks());

const item = (ar: string, sortOrder: number | null): FleetCatalogItemDoc =>
  ({
    _id: new Types.ObjectId(),
    kind: 'workshop',
    name: { ar, en: ar },
    countsForAlarm: false,
    violationSide: null,
    isActive: true,
    sortOrder,
  }) as unknown as FleetCatalogItemDoc;

describe('saving a list’s order', () => {
  it('writes the dragged order, and keeps the items not named after them in their old order', async () => {
    const [a, b, c, d] = [item('أ', 0), item('ب', 1), item('ج', 2), item('د', 3)];
    vi.spyOn(fleetCatalogItemRepository, 'listKind').mockResolvedValue([a!, b!, c!, d!]);
    const written = vi.spyOn(fleetCatalogItemRepository, 'writeOrder').mockResolvedValue();
    vi.spyOn(auditService, 'record').mockResolvedValue();
    // The screen showed only c and a (a filter), with c dragged above a.
    await fleetCatalogItemService.order(
      { kind: 'workshop', ids: [String(c!._id), String(a!._id)] },
      new Types.ObjectId().toString(),
    );
    expect(written.mock.calls[0]?.[0].map(String)).toEqual([c, a, b, d].map((x) => String(x!._id)));
  });

  it('refuses an id that is not an item of that list', async () => {
    vi.spyOn(fleetCatalogItemRepository, 'listKind').mockResolvedValue([item('أ', 0)]);
    await expect(
      fleetCatalogItemService.order(
        { kind: 'workshop', ids: [new Types.ObjectId().toString()] },
        new Types.ObjectId().toString(),
      ),
    ).rejects.toMatchObject({ httpStatus: 409 });
  });

  it('reads the list in its arranged order when no column is asked for', async () => {
    const listed = vi
      .spyOn(fleetCatalogItemRepository, 'list')
      .mockResolvedValue({
        items: [],
        meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
      });
    await fleetCatalogItemService.list({
      kind: 'workshop',
      page: 1,
      pageSize: 25,
      sortDir: 'desc',
    } as never);
    expect(listed.mock.calls[0]?.[0].sorts).toEqual([
      { by: 'sortOrder', dir: 'asc' },
      { by: 'name.ar', dir: 'asc' },
    ]);
  });
});
