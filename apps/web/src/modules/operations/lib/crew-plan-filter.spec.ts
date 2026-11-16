// «لوحة التشغيلة»'s three new filters (Round 24): «انه يقدر يفلتر ب كود عربيه و كمان ادخل اسم قائد او
// اخصائى او الكود بتاع اى حد فيهم وكمان افلتر ب الاتجاه».
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../../../platform/localization/i18n';
import {
  EMPTY_ROW_FILTER,
  NO_DIRECTION,
  NO_VAN,
  directionFilterOptions,
  directionParts,
  isRowFiltering,
  matchesPerson,
  matchesRowFilter,
  vanFilterOptions,
  type PlanRowFilter,
} from './crew-plan-filter';
import { vehiclelessRow, type PlanRow } from './crew-plan';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const row = (key: string, over: Partial<PlanRow> = {}): PlanRow => ({
  ...vehiclelessRow(0),
  key,
  ...over,
});
const van = (code: string, over: Partial<PlanRow> = {}): PlanRow =>
  row(`van:v-${code}`, { vehicleId: `v-${code}`, vehicleCode: code, onRoster: true, ...over });

const PEOPLE: Record<string, { fullNameAr: string; code: string }> = {
  a: { fullNameAr: 'أحمد سمير', code: '1203' },
  b: { fullNameAr: 'محمود علي', code: '88' },
  c: { fullNameAr: 'هشام يوسف', code: '450' },
};
const memberOf = (employeeId: string) => PEOPLE[employeeId];
const AREAS = ['المعادي', 'حلوان', 'مدينة نصر', 'شبرا/الخيمة'];

const ROWS = [
  van('150', {
    slots: { captain: ['a'], specialist1: ['b'], specialist2: [] },
    direction: 'المعادي - حلوان',
  }),
  van('9', {
    slots: { captain: [], specialist1: [], specialist2: ['c'] },
    direction: 'شبرا/الخيمة',
  }),
  van('24', { direction: null }),
  row('loose:x', {
    slots: { captain: ['c'], specialist1: [], specialist2: [] },
    direction: 'مدينة نصر',
  }),
];

const shown = (filter: Partial<PlanRowFilter>): string[] =>
  ROWS.filter((one) =>
    matchesRowFilter(one, { ...EMPTY_ROW_FILTER, ...filter }, { memberOf, areaNames: AREAS }),
  ).map((one) => one.key);

describe('the van — by code, and «بدون سيارة»', () => {
  it('lists the board’s vans by code, numbers in number order', () => {
    expect(vanFilterOptions(ROWS).map((option) => option.label)).toEqual(['9', '24', '150']);
  });

  it('shows the vans picked (OR), and the rows without a van under «بدون سيارة»', () => {
    expect(shown({ vans: ['v-9', 'v-150'] })).toEqual(['van:v-150', 'van:v-9']);
    expect(shown({ vans: [NO_VAN] })).toEqual(['loose:x']);
    expect(shown({})).toHaveLength(ROWS.length);
  });
});

describe('the person — a captain’s or a specialist’s name or code', () => {
  it('finds a name folded as the pools fold it, and a code in either keyboard’s digits', () => {
    expect(shown({ person: 'احمد' })).toEqual(['van:v-150']);
    expect(shown({ person: 'محمود' })).toEqual(['van:v-150']);
    expect(shown({ person: '٤٥٠' })).toEqual(['van:v-9', 'loose:x']);
    expect(shown({ person: 'لا أحد' })).toEqual([]);
    // Somebody the roster no longer names is matched by nothing — never by an id.
    expect(
      matchesPerson(
        row('r', { slots: { captain: ['zz'], specialist1: [], specialist2: [] } }),
        'zz',
        memberOf,
      ),
    ).toBe(false);
  });
});

describe('the direction — each area a direction names, and «بدون اتجاه»', () => {
  it('splits a direction as the save does, but never an area whose name holds a separator', () => {
    expect(directionParts('المعادي - حلوان', AREAS).map((part) => part.label)).toEqual([
      'المعادي',
      'حلوان',
    ]);
    expect(directionParts('شبرا/الخيمة', AREAS).map((part) => part.label)).toEqual(['شبرا/الخيمة']);
    expect(directionParts(null, AREAS)).toEqual([]);
    expect(directionFilterOptions(ROWS, AREAS).map((option) => option.label)).toEqual([
      'المعادي',
      'حلوان',
      'شبرا/الخيمة',
      'مدينة نصر',
    ]);
  });

  it('a row of two areas is found under each; «بدون اتجاه» finds the rows with none', () => {
    const helwan = directionParts('حلوان', AREAS)[0]?.value as string;
    expect(shown({ directions: [helwan] })).toEqual(['van:v-150']);
    expect(shown({ directions: [NO_DIRECTION] })).toEqual(['van:v-24']);
  });
});

describe('AND-ed, view only', () => {
  it('a row is shown when it passes every filter set', () => {
    const maadi = directionParts('المعادي', AREAS)[0]?.value as string;
    expect(shown({ vans: ['v-150', NO_VAN], person: 'هشام' })).toEqual(['loose:x']);
    expect(shown({ vans: ['v-150'], directions: [maadi], person: '1203' })).toEqual(['van:v-150']);
    expect(shown({ vans: ['v-150'], person: 'هشام' })).toEqual([]);
    expect(isRowFiltering(EMPTY_ROW_FILTER)).toBe(false);
    expect(isRowFiltering({ ...EMPTY_ROW_FILTER, person: '  ' })).toBe(false);
    expect(isRowFiltering({ ...EMPTY_ROW_FILTER, vans: [NO_VAN] })).toBe(true);
  });

  it('the page: between the day and the type, in that order — filtering the table only, the chips the whole day', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    const bar = page.slice(page.indexOf('data-crew-plan-bar="true"'));
    const at = (needle: string): number => bar.indexOf(needle);
    expect(at('<DayBox')).toBeLessThan(at("t('operations.crewPlan.filter.van')"));
    expect(at("t('operations.crewPlan.filter.van')")).toBeLessThan(
      at("t('operations.crewPlan.filter.person')"),
    );
    expect(at("t('operations.crewPlan.filter.person')")).toBeLessThan(
      at("t('operations.crewPlan.filter.direction')"),
    );
    expect(at("t('operations.crewPlan.filter.direction')")).toBeLessThan(
      at("t('operations.crewPlan.typeAll')"),
    );
    // The save is built from every row, the table from the filtered ones; the strip from every row.
    expect(page).toContain('const changes = planChanges(rows, serverRows);');
    expect(page).toContain('rows={shown as PlanRow[]}');
    expect(page).toContain('const strip = shiftTypeStrip(shiftTypes, rows);');
    expect(translate('ar', 'operations.crewPlan.filter.shown', { shown: '٥', total: '٤٨' })).toBe(
      'المعروض ٥ من ٤٨',
    );
    expect(translate('ar', 'operations.crewPlan.countsHint')).toContain('كل صفوف اليوم');
  });
});
