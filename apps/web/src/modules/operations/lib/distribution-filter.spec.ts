// Round 25 — the two filter bars of «توزيع المحصنات»: «احط فلتر فوق يبقى خانة اقدر ابحث عن البنك او الفرع
// و خانة للمنطقة» (the محصنات on no van) and «خانة اقدر ابحث عن كود العربيه و خانة البنك او الفرع و خانة
// للمنطقة» (the vans).
import { describe, expect, it } from 'vitest';
import { foldOperationsAreaName } from '@ecms/contracts';
import {
  EMPTY_UNPLACED_FILTER,
  EMPTY_VAN_FILTER,
  NO_AREA,
  isUnplacedFiltering,
  isVanFiltering,
  matchesUnplacedFilter,
  matchesVanFilter,
  shipmentAreaOptions,
  shipmentMatchesArea,
  shipmentMatchesSearch,
  vanAreaOptions,
  vanMatchesArea,
  vanMatchesCode,
  type FilterShipment,
} from './distribution-filter';

const BANKS: Record<string, string[]> = {
  'b-ahly': ['الأهلي', 'البنك الأهلي المصري', 'National Bank of Egypt'],
  'b-misr': ['مصر', 'بنك مصر', 'Banque Misr'],
};
const bankWordsOf = (id: string): string[] => BANKS[id] ?? [];

const row = (over: Partial<FilterShipment> = {}): FilterShipment => ({
  mainBankId: 'b-ahly',
  areaName: 'المعادي',
  origin: { name: 'فرع المهندسين', bankName: 'الأهلي' },
  destination: { name: 'فرع المعادي', bankName: 'الأهلي' },
  ...over,
});

const MAADI = row();
const HARAM = row({
  mainBankId: 'b-misr',
  areaName: 'الهرم',
  origin: { name: 'فرع الهرم', bankName: 'مصر' },
  destination: { name: 'فرع فيصل', bankName: 'مصر' },
});
const NOWHERE = row({ areaName: null });

describe('the bank-or-branch box', () => {
  it('finds the billed bank by any of its names, folded as typed («الاهلى» is «الأهلي»)', () => {
    expect(shipmentMatchesSearch(MAADI, 'الاهلى', bankWordsOf)).toBe(true);
    expect(shipmentMatchesSearch(MAADI, 'national', bankWordsOf)).toBe(true);
    expect(shipmentMatchesSearch(HARAM, 'الاهلى', bankWordsOf)).toBe(false);
  });

  it('finds either branch by its name, and each branch’s own bank', () => {
    expect(shipmentMatchesSearch(MAADI, 'المهندسين', bankWordsOf)).toBe(true);
    expect(shipmentMatchesSearch(HARAM, 'فيصل', bankWordsOf)).toBe(true);
    const crossed = row({ destination: { name: 'فرع الزمالك', bankName: 'القاهرة' } });
    expect(shipmentMatchesSearch(crossed, 'القاهره', bankWordsOf)).toBe(true);
  });

  it('blank finds everything; a word nobody has finds nothing', () => {
    expect(shipmentMatchesSearch(HARAM, '  ', bankWordsOf)).toBe(true);
    expect(shipmentMatchesSearch(HARAM, 'العباسية', bankWordsOf)).toBe(false);
  });
});

describe('the area box', () => {
  const maadi = foldOperationsAreaName('المعادي');

  it('an area is matched folded — «المعادى» is «المعادي»', () => {
    expect(shipmentMatchesArea(row({ areaName: 'المعادى' }), maadi)).toBe(true);
    expect(shipmentMatchesArea(HARAM, maadi)).toBe(false);
  });

  it('«بلا منطقة» takes those that name none; no choice takes every one', () => {
    expect(shipmentMatchesArea(NOWHERE, NO_AREA)).toBe(true);
    expect(shipmentMatchesArea(MAADI, NO_AREA)).toBe(false);
    expect(shipmentMatchesArea(NOWHERE, '')).toBe(true);
  });

  it('offers the areas present, once each, in Arabic order — «بلا منطقة» last when one names none', () => {
    const options = shipmentAreaOptions([HARAM, MAADI, row({ areaName: 'المعادى' }), NOWHERE]);
    expect(options.map((option) => option.label)).toEqual(['المعادي', 'الهرم', '']);
    expect(options.at(-1)?.value).toBe(NO_AREA);
    expect(shipmentAreaOptions([MAADI]).map((o) => o.value)).toEqual([maadi]);
  });

  it('keeps offering the area chosen when no محصنة of it is left on the left', () => {
    const haram = foldOperationsAreaName('الهرم');
    expect(shipmentAreaOptions([MAADI], haram).map((o) => o.value)).toEqual([maadi, haram]);
  });
});

describe('the left bar, AND-ed', () => {
  it('both boxes must hold', () => {
    const filter = { search: 'الاهلي', area: foldOperationsAreaName('المعادي') };
    expect(matchesUnplacedFilter(MAADI, filter, bankWordsOf)).toBe(true);
    expect(matchesUnplacedFilter(row({ areaName: 'حلوان' }), filter, bankWordsOf)).toBe(false);
    expect(matchesUnplacedFilter(HARAM, filter, bankWordsOf)).toBe(false);
  });

  it('empty — every محصنة, and nothing to clear', () => {
    expect(isUnplacedFiltering(EMPTY_UNPLACED_FILTER)).toBe(false);
    expect(matchesUnplacedFilter(HARAM, EMPTY_UNPLACED_FILTER, bankWordsOf)).toBe(true);
    expect(isUnplacedFiltering({ search: ' ', area: '' })).toBe(false);
    expect(isUnplacedFiltering({ search: '', area: NO_AREA })).toBe(true);
  });
});

describe('the right bar — the vans', () => {
  const V104 = { vehicleCode: '104', direction: 'المعادي - حلوان' };
  const LOOSE = { vehicleCode: null, direction: null };

  it('the code box: a van’s code, «١٠٤» as 104; a crew without a van by the name it is given', () => {
    expect(vanMatchesCode(V104, '١٠٤', '104')).toBe(true);
    expect(vanMatchesCode(V104, '10', '104')).toBe(true);
    expect(vanMatchesCode(V104, '125', '104')).toBe(false);
    expect(vanMatchesCode(LOOSE, 'بدون', 'بدون سيارة (2)')).toBe(true);
    expect(vanMatchesCode(LOOSE, '', 'بدون سيارة (2)')).toBe(true);
  });

  it('the area box: its direction names it — either area of a direction of two — or a محصنة on it is of it', () => {
    const halwan = foldOperationsAreaName('حلوان');
    const haram = foldOperationsAreaName('الهرم');
    expect(vanMatchesArea(V104, [], halwan)).toBe(true);
    expect(vanMatchesArea(V104, [], haram)).toBe(false);
    expect(vanMatchesArea(V104, [HARAM], haram)).toBe(true);
    expect(vanMatchesArea(LOOSE, [], NO_AREA)).toBe(true);
    expect(vanMatchesArea(V104, [], NO_AREA)).toBe(false);
  });

  it('the bank-or-branch box: a van answers through one of its محصنات; an empty van answers nothing typed', () => {
    const context = { name: '104', bankWordsOf };
    const filter = { ...EMPTY_VAN_FILTER, search: 'بنك مصر' };
    expect(matchesVanFilter(V104, [MAADI, HARAM], filter, context)).toBe(true);
    expect(matchesVanFilter(V104, [MAADI], filter, context)).toBe(false);
    expect(matchesVanFilter(V104, [], filter, context)).toBe(false);
  });

  it('the three AND-ed; empty — every van', () => {
    const context = { name: '104', bankWordsOf };
    expect(
      matchesVanFilter(
        V104,
        [MAADI],
        { code: '104', search: 'المعادي', area: foldOperationsAreaName('حلوان') },
        context,
      ),
    ).toBe(true);
    expect(
      matchesVanFilter(V104, [MAADI], { code: '125', search: 'المعادي', area: '' }, context),
    ).toBe(false);
    expect(isVanFiltering(EMPTY_VAN_FILTER)).toBe(false);
    expect(
      matchesVanFilter(LOOSE, [], EMPTY_VAN_FILTER, { name: 'بدون سيارة (1)', bankWordsOf }),
    ).toBe(true);
    expect(isVanFiltering({ code: '1', search: '', area: '' })).toBe(true);
  });

  it('offers every area the directions and the loads name, once — «بلا اتجاه» when a van has none', () => {
    const options = vanAreaOptions([
      { van: V104, rows: [HARAM] },
      { van: LOOSE, rows: [] },
    ]);
    expect(options.map((option) => option.label)).toEqual(['المعادي', 'الهرم', 'حلوان', '']);
    expect(options.at(-1)?.value).toBe(NO_AREA);
  });
});
