// «النوع» on the receipts table, as the repository asks for it: in the kinds' own order — وقود،
// كاوتش، غسيل، صيانة, the dialog's tabs and the filter's list — not the alphabet of the stored
// keys, which would put «صيانة» (`maintenance`) between وقود and كاوتش. The order itself runs
// against a real mongo in the integration suite (`fleet-derived-sort.spec.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLEET_RECEIPT_KINDS } from '@ecms/contracts';
import { VEHICLE_CODE_SORT } from '../vehicles/vehicle.repository';
import { RECEIPT_KIND_SORT, fleetReceiptRepository } from './receipt.repository';

afterEach(() => vi.restoreAllMocks());

/** The parameters `listReceipts` hands the base list — no database touched. */
const sent = async (
  params: Partial<Parameters<typeof fleetReceiptRepository.listReceipts>[0]>,
): Promise<Parameters<typeof fleetReceiptRepository.list>[0]> => {
  const list = vi.spyOn(fleetReceiptRepository, 'list').mockResolvedValue({
    items: [],
    meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
  });
  await fleetReceiptRepository.listReceipts({ page: 1, pageSize: 25, ...params });
  return list.mock.calls[0]![0];
};

describe('«النوع» on the receipts table', () => {
  it('ranks a receipt by its kind’s place in the kinds’ list — «صيانة» after «غسيل»', () => {
    expect(FLEET_RECEIPT_KINDS).toEqual(['fuel', 'tyres', 'wash', 'maintenance']);
    expect(RECEIPT_KIND_SORT.expression).toEqual({
      $indexOfArray: [{ $literal: ['fuel', 'tyres', 'wash', 'maintenance'] }, '$kind'],
    });
    // A computed key of its own name — never the stored `kind`, which the page must still carry.
    expect(RECEIPT_KIND_SORT.key).not.toBe('kind');
  });

  it('turns the column’s `kind` into that rank, alone or among several columns', async () => {
    const single = await sent({ sortBy: 'kind', sortDir: 'asc' });
    expect(single.sortBy).toBe(RECEIPT_KIND_SORT.key);
    const several = await sent({
      sorts: [
        { by: 'kind', dir: 'asc' },
        { by: 'date', dir: 'desc' },
      ],
    });
    expect(several.sorts).toEqual([
      { by: RECEIPT_KIND_SORT.key, dir: 'asc' },
      { by: 'date', dir: 'desc' },
    ]);
    expect(several.sortableFields).toContain(RECEIPT_KIND_SORT.key);
    expect(several.sortableFields).not.toContain('kind');
    expect(several.sortDerived).toEqual([VEHICLE_CODE_SORT, RECEIPT_KIND_SORT]);
  });

  it('leaves every other column as it was asked', async () => {
    const params = await sent({ sortBy: 'date', sortDir: 'desc' });
    expect(params.sortBy).toBe('date');
    expect(params).not.toHaveProperty('sorts');
    for (const field of ['date', 'amount', 'litres', 'odometer', 'source', 'driverName']) {
      expect(params.sortableFields, field).toContain(field);
    }
  });
});
