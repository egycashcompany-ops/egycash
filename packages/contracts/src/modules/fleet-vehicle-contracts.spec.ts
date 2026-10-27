// «عقود توريد السيارات»: the shapes require only what the owner requires — a date and one line, a
// line's make and count — and the alarm and the money follow one rule the API and the screens share.
import { describe, expect, it } from 'vitest';
import {
  CreateFleetVehicleContractSchema,
  FLEET_SUPPLY_ALARM_RED_DAYS,
  FLEET_SUPPLY_ALARM_YELLOW_DAYS,
  FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX,
  FleetVehicleContractSummaryQuerySchema,
  ListFleetVehicleContractsQuerySchema,
  OrderFleetVehicleContractFilesSchema,
  SaveFleetVehicleContractDeliverySchema,
  UpdateFleetVehicleContractSchema,
  fleetContractLineTotal,
  fleetDaysBetween,
  fleetSupplyAlarmLevel,
} from './fleet-vehicle-contracts.js';
import * as contracts from '../index.js';

const oid = (suffix: string) => suffix.padStart(24, '0');
const UPPER = 'ABCDEF0123456789ABCDEF01';
const LOWER = 'abcdef0123456789abcdef01';
const paths = (result: { success: boolean; error?: { issues: { path: unknown[] }[] } }) =>
  (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

describe('a vehicle supply contract — «ومش عاوز اى داتا اجبارى»', () => {
  it('needs its date and one line of a make and a count — nothing else', () => {
    expect(
      CreateFleetVehicleContractSchema.parse({
        date: '2025-12-01',
        lines: [{ typeId: oid('a'), count: 22 }],
      }),
    ).toEqual({
      name: '',
      date: new Date('2025-12-01'),
      deadline: null,
      supplier: '',
      lines: [{ id: null, typeId: oid('a'), count: 22, unitPrice: null }],
    });
  });

  it('takes an empty name and supplier, no deadline and no price — and trims the text', () => {
    const parsed = CreateFleetVehicleContractSchema.parse({
      name: '  عقد توريد 33 سيارة  ',
      date: '2025-12-01',
      deadline: null,
      supplier: '',
      lines: [{ id: null, typeId: oid('a'), count: 1, unitPrice: null }],
    });
    expect(parsed).toMatchObject({ name: 'عقد توريد 33 سيارة', deadline: null, supplier: '' });
    expect(
      CreateFleetVehicleContractSchema.parse({
        date: '2025-12-01',
        deadline: '2026-10-24',
        lines: [{ typeId: oid('a'), count: 22, unitPrice: 4_700_000 }],
      }).deadline,
    ).toEqual(new Date('2026-10-24'));
  });

  it('refuses no date, no line, a line without a make, and a count below one', () => {
    const line = { typeId: oid('a'), count: 1 };
    expect(CreateFleetVehicleContractSchema.safeParse({ lines: [line] }).success).toBe(false);
    expect(
      CreateFleetVehicleContractSchema.safeParse({ date: '2025-12-01', lines: [] }).success,
    ).toBe(false);
    expect(
      CreateFleetVehicleContractSchema.safeParse({ date: '2025-12-01', lines: [{ count: 1 }] })
        .success,
    ).toBe(false);
    for (const count of [0, -1, 1.5]) {
      expect(
        CreateFleetVehicleContractSchema.safeParse({
          date: '2025-12-01',
          lines: [{ ...line, count }],
        }).success,
      ).toBe(false);
    }
    expect(
      CreateFleetVehicleContractSchema.safeParse({ date: '2025-12-01', lines: [line], extra: 1 })
        .success,
    ).toBe(false);
  });

  it('a unit price is to the piastre, never negative, and bounded so a contract sums exactly', () => {
    const withPrice = (unitPrice: number) =>
      CreateFleetVehicleContractSchema.safeParse({
        date: '2025-12-01',
        lines: [{ typeId: oid('a'), count: 1, unitPrice }],
      }).success;
    expect(withPrice(5_400_000.25)).toBe(true);
    expect(withPrice(0)).toBe(true);
    expect(withPrice(FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX)).toBe(true);
    expect(withPrice(FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX + 1)).toBe(false);
    expect(withPrice(10.005)).toBe(false);
    expect(withPrice(-1)).toBe(false);
    // 100 lines × 10,000 cars at the dearest price stays exact in piastres.
    expect(FLEET_VEHICLE_CONTRACT_UNIT_PRICE_MAX * 100 * 100 * 10_000).toBeLessThanOrEqual(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('a new contract has no saved lines', () => {
    const result = CreateFleetVehicleContractSchema.safeParse({
      date: '2025-12-01',
      lines: [{ id: oid('1'), typeId: oid('a'), count: 1 }],
    });
    expect(result.success).toBe(false);
    expect(paths(result)).toEqual(['lines']);
  });

  it('an edit carries its version and names each saved line once, however it is spelled', () => {
    const body = (lines: { id: string | null }[]) => ({
      date: '2025-12-01',
      version: 3,
      lines: lines.map((line) => ({ ...line, typeId: oid('a'), count: 2 })),
    });
    expect(
      UpdateFleetVehicleContractSchema.parse(body([{ id: oid('1') }, { id: null }, { id: null }]))
        .version,
    ).toBe(3);
    const twice = UpdateFleetVehicleContractSchema.safeParse(
      body([{ id: oid('1') }, { id: oid('1') }]),
    );
    expect(twice.success).toBe(false);
    expect(paths(twice)).toEqual(['lines']);
    expect(
      UpdateFleetVehicleContractSchema.safeParse(body([{ id: UPPER }, { id: LOWER }])).success,
    ).toBe(false);
    const noVersion = { date: '2025-12-01', lines: [{ typeId: oid('a'), count: 2 }] };
    expect(UpdateFleetVehicleContractSchema.safeParse(noVersion).success).toBe(false);
    expect(UpdateFleetVehicleContractSchema.safeParse({ ...noVersion, version: 0 }).success).toBe(
      true,
    );
  });
});

describe('a delivery — «تسجيل استلام»', () => {
  const delivery = (counts: { lineId: string; count: number }[]) => ({
    date: '2026-10-19',
    counts,
    version: 0,
  });

  it('takes a day and the cars per line, zeros allowed beside a received one', () => {
    expect(
      SaveFleetVehicleContractDeliverySchema.parse(
        delivery([
          { lineId: oid('1'), count: 8 },
          { lineId: oid('2'), count: 0 },
        ]),
      ),
    ).toEqual({
      date: new Date('2026-10-19'),
      counts: [
        { lineId: oid('1'), count: 8 },
        { lineId: oid('2'), count: 0 },
      ],
      version: 0,
    });
  });

  it('refuses receiving nothing, a line named twice in any spelling, and a negative count', () => {
    const none = SaveFleetVehicleContractDeliverySchema.safeParse(
      delivery([
        { lineId: oid('1'), count: 0 },
        { lineId: oid('2'), count: 0 },
      ]),
    );
    expect(none.success).toBe(false);
    expect(paths(none)).toEqual(['counts']);
    const twice = SaveFleetVehicleContractDeliverySchema.safeParse(
      delivery([
        { lineId: oid('1'), count: 3 },
        { lineId: oid('1'), count: 4 },
      ]),
    );
    expect(paths(twice)).toEqual(['counts']);
    expect(
      SaveFleetVehicleContractDeliverySchema.safeParse(
        delivery([
          { lineId: UPPER, count: 3 },
          { lineId: LOWER, count: 4 },
        ]),
      ).success,
    ).toBe(false);
    expect(
      SaveFleetVehicleContractDeliverySchema.safeParse(delivery([{ lineId: oid('1'), count: -1 }]))
        .success,
    ).toBe(false);
    expect(SaveFleetVehicleContractDeliverySchema.safeParse(delivery([])).success).toBe(false);
    const noVersion = { date: '2026-10-19', counts: [{ lineId: oid('1'), count: 1 }] };
    expect(SaveFleetVehicleContractDeliverySchema.safeParse(noVersion).success).toBe(false);
    expect(
      SaveFleetVehicleContractDeliverySchema.safeParse({ ...noVersion, version: 0 }).success,
    ).toBe(true);
  });
});

describe('the attachments’ order and the list’s filters', () => {
  it('an order names each attachment once, however it is spelled', () => {
    expect(
      OrderFleetVehicleContractFilesSchema.parse({ fileIds: [oid('2'), oid('1')] }).fileIds,
    ).toEqual([oid('2'), oid('1')]);
    expect(OrderFleetVehicleContractFilesSchema.safeParse({ fileIds: [] }).success).toBe(false);
    const twice = OrderFleetVehicleContractFilesSchema.safeParse({ fileIds: [UPPER, LOWER] });
    expect(twice.success).toBe(false);
    expect(paths(twice)).toEqual(['fileIds']);
  });

  it('filters by period, suppliers, makes and alarm level; the list alone is sorted and paged', () => {
    expect(
      ListFleetVehicleContractsQuerySchema.parse({
        from: '2025-01-01',
        suppliers: 'المنصور للسيارات،فرع القاهرة,غبور',
        typeIds: `${oid('a')},${oid('b')}`,
        alarm: 'red,yellow',
        sort: 'alarmRank:desc',
        page: '2',
      }),
    ).toMatchObject({
      suppliers: ['المنصور للسيارات،فرع القاهرة', 'غبور'],
      typeIds: [oid('a'), oid('b')],
      alarm: ['red', 'yellow'],
      sort: 'alarmRank:desc',
      page: 2,
    });
    expect(ListFleetVehicleContractsQuerySchema.safeParse({ alarm: 'green' }).success).toBe(false);
    expect(ListFleetVehicleContractsQuerySchema.safeParse({ typeIds: '7' }).success).toBe(false);
    expect(FleetVehicleContractSummaryQuerySchema.parse({ alarm: 'red' }).alarm).toEqual(['red']);
    expect(FleetVehicleContractSummaryQuerySchema.safeParse({ sort: 'date:desc' }).success).toBe(
      false,
    );
    expect(FleetVehicleContractSummaryQuerySchema.safeParse({ page: '1' }).success).toBe(false);
  });
});

describe('«إنذار التوريد» and the money', () => {
  it('yellow from 30 days out, red from 7 and once overdue; none when owed nothing or no deadline', () => {
    expect([FLEET_SUPPLY_ALARM_YELLOW_DAYS, FLEET_SUPPLY_ALARM_RED_DAYS]).toEqual([30, 7]);
    expect(fleetSupplyAlarmLevel(31, 5)).toBeNull();
    expect(fleetSupplyAlarmLevel(30, 5)).toBe('yellow');
    expect(fleetSupplyAlarmLevel(8, 5)).toBe('yellow');
    expect(fleetSupplyAlarmLevel(7, 5)).toBe('red');
    expect(fleetSupplyAlarmLevel(0, 5)).toBe('red');
    expect(fleetSupplyAlarmLevel(-9, 5)).toBe('red');
    expect(fleetSupplyAlarmLevel(5, 0)).toBeNull();
    expect(fleetSupplyAlarmLevel(-9, -1)).toBeNull();
    expect(fleetSupplyAlarmLevel(null, 5)).toBeNull();
  });

  it('counts calendar days between two days, either way, and nothing for a day that is not one', () => {
    expect(fleetDaysBetween('2026-10-19', '2026-10-24')).toBe(5);
    expect(fleetDaysBetween('2026-10-19', '2026-10-10')).toBe(-9);
    expect(fleetDaysBetween('2026-10-19', '2026-10-19')).toBe(0);
    expect(fleetDaysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(fleetDaysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(fleetDaysBetween('2026-10-19', '2026-11-18T00:00:00.000Z')).toBe(30);
    expect(fleetDaysBetween('2026-02-30', '2026-03-01')).toBeNull();
    expect(fleetDaysBetween('soon', '2026-03-01')).toBeNull();
  });

  it('totals a line in piastres — 22 × 4,700,000 + 11 × 5,400,000 = 162,800,000', () => {
    const a = fleetContractLineTotal(22, 4_700_000);
    const b = fleetContractLineTotal(11, 5_400_000);
    expect([a, b]).toEqual([103_400_000, 59_400_000]);
    expect((a ?? 0) + (b ?? 0)).toBe(162_800_000);
    expect(fleetContractLineTotal(3, 0.1)).toBe(0.3);
    expect(fleetContractLineTotal(7, 1_234.56)).toBe(8_641.92);
    expect(fleetContractLineTotal(5, null)).toBeNull();
  });

  it('the package exports it all, and nothing collides with HR’s contracts', () => {
    expect(contracts.CreateFleetVehicleContractSchema).toBe(CreateFleetVehicleContractSchema);
    expect(contracts.fleetSupplyAlarmLevel).toBe(fleetSupplyAlarmLevel);
    expect(contracts.FLEET_VEHICLE_CONTRACT_FILE_CATEGORY).toBe('fleet-vehicle-contracts');
    expect(contracts.FLEET_VEHICLE_CONTRACT_FILE_MIMES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ]);
    expect(contracts.FLEET_VEHICLE_CONTRACT_FILE_MAX_MB).toBe(10);
  });
});
