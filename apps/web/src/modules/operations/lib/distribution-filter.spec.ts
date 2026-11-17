// Round 25 — the two filter bars of «توزيع المحصنات»: «احط فلتر فوق يبقى خانة اقدر ابحث عن البنك او الفرع
// و خانة للمنطقة» (the محصنات on no van) and «خانة اقدر ابحث عن كود العربيه و خانة البنك او الفرع و خانة
// للمنطقة» (the vans). Round 26b — «وعاوز اضيف اسم القائد فى الفلاتر بعد العربيه»: the captain's box.
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
  vanMatchesCaptain,
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
        { code: '104', captain: '', search: 'المعادي', area: foldOperationsAreaName('حلوان') },
        context,
      ),
    ).toBe(true);
    expect(
      matchesVanFilter(
        V104,
        [MAADI],
        { code: '125', captain: '', search: 'المعادي', area: '' },
        context,
      ),
    ).toBe(false);
    expect(isVanFiltering(EMPTY_VAN_FILTER)).toBe(false);
    expect(
      matchesVanFilter(LOOSE, [], EMPTY_VAN_FILTER, { name: 'بدون سيارة (1)', bankWordsOf }),
    ).toBe(true);
    expect(isVanFiltering({ code: '1', captain: '', search: '', area: '' })).toBe(true);
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

describe('Round 26b — the captain’s box, after the van’s code', () => {
  // Two captains on 112: the card shows the first (عبد الرحمن); the box finds the van by either.
  const V112 = {
    vehicleCode: '112',
    direction: 'الجيزة',
    captains: [
      { fullNameAr: 'عبد الرحمن محمد الشناوي', code: 'BR-107' },
      { fullNameAr: 'مصطفى إبراهيم حسين', code: 'BR-108' },
    ],
  };
  const V125 = { vehicleCode: '125', direction: 'حلوان', captains: [] };
  const LOOSE = {
    vehicleCode: null,
    direction: null,
    captains: [{ fullNameAr: 'أحمد فتحي السيد', code: null }],
  };
  const context = { name: '112', bankWordsOf };
  const only = (captain: string) => ({ ...EMPTY_VAN_FILTER, captain });

  it('finds a van by its FIRST captain — or by its SECOND, whom the card does not show', () => {
    expect(vanMatchesCaptain(V112, 'الشناوي')).toBe(true);
    expect(vanMatchesCaptain(V112, 'مصطفى')).toBe(true);
    expect(vanMatchesCaptain(V112, 'إبراهيم حسين')).toBe(true);
    expect(vanMatchesCaptain(V112, 'كريم')).toBe(false);
    expect(matchesVanFilter(V112, [], only('مصطفى'), context)).toBe(true);
    expect(matchesVanFilter(V112, [], only('كريم'), context)).toBe(false);
  });

  it('by his employee code too — the hyphen and the Latin case as typed or not', () => {
    expect(vanMatchesCaptain(V112, 'BR-108')).toBe(true);
    expect(vanMatchesCaptain(V112, 'br108')).toBe(true);
    expect(vanMatchesCaptain(V112, '107')).toBe(true);
    expect(vanMatchesCaptain(V112, 'BR-109')).toBe(false);
    // A captain with no code is found by his name only.
    expect(vanMatchesCaptain(LOOSE, 'احمد')).toBe(true);
  });

  it('folds the Arabic as every box here does — alef, ya and ta marbuta forms, the hamza', () => {
    expect(vanMatchesCaptain(V112, 'مصطفي')).toBe(true); // ى typed as ي
    expect(vanMatchesCaptain(V112, 'ابراهيم')).toBe(true); // إ typed as ا
    expect(vanMatchesCaptain(LOOSE, 'احمد فتحى')).toBe(true); // أ and ي both folded
    expect(
      vanMatchesCaptain(
        { vehicleCode: '1', direction: null, captains: [{ fullNameAr: 'رحمة', code: null }] },
        'رحمه',
      ),
    ).toBe(true); // ة typed as ه
    expect(vanMatchesCaptain(V112, '  الشناوى  ')).toBe(true);
  });

  it('a van with no captain answers no typed name — and every name when the box is blank', () => {
    expect(vanMatchesCaptain(V125, 'أحمد')).toBe(false);
    expect(vanMatchesCaptain(V125, '')).toBe(true);
    expect(vanMatchesCaptain(V125, '   ')).toBe(true);
    // A van read without its captains (an older shape) answers no typed name either.
    expect(vanMatchesCaptain({ vehicleCode: '9', direction: null }, 'أحمد')).toBe(false);
  });

  it('AND-ed with the code, the bank or branch and the area — every box must hold', () => {
    const giza = foldOperationsAreaName('الجيزة');
    const all = { code: '112', captain: 'مصطفى', search: 'الأهلي', area: giza };
    expect(matchesVanFilter(V112, [MAADI], all, context)).toBe(true);
    expect(matchesVanFilter(V112, [MAADI], { ...all, captain: 'كريم' }, context)).toBe(false);
    expect(matchesVanFilter(V112, [MAADI], { ...all, code: '104' }, context)).toBe(false);
    expect(matchesVanFilter(V112, [HARAM], { ...all, search: 'الأهلي' }, context)).toBe(false);
    expect(
      matchesVanFilter(V112, [MAADI], { ...all, area: foldOperationsAreaName('حلوان') }, context),
    ).toBe(false);
  });

  it('a name typed is a filter in use — «المعروض … من …» and «مسح التصفية» count it; the empty bar has none', () => {
    expect(isVanFiltering(only('مصطفى'))).toBe(true);
    expect(isVanFiltering(only('  '))).toBe(false);
    expect(EMPTY_VAN_FILTER.captain).toBe('');
  });
});
