// The open boards, area by area (2026-11-02): «Group by المناطق + Sorting بالمناطق بردو · يعني كل
// منطقة تظهر اعطالها وتغذياتها تحت بعض + بترتيب ابجدى للمناطق». These pin:
//
//   · the areas run in Arabic alphabetical order, not code-point order, and a row with no area
//     goes last in both directions;
//   · one area is ONE run of rows: a spelling with surrounding spaces is the same area, and two
//     names that collate as equal still never interleave;
//   · inside an area the rows keep the order they came in (the reader's columns, then the board's
//     own order);
//   · the head's arrows and a click on them: the area is always first and lit, a click on it turns
//     the areas round, and a click elsewhere orders inside the areas.
//
// Every name below is synthetic.
import { describe, expect, it } from 'vitest';
import {
  areaGroupLine,
  areaGroupOf,
  boardAreaOrder,
  clickBoardSort,
  compareAreas,
  groupRowsByArea,
} from './area-groups';

type Row = { id: string; area: string };
const row = (id: string, area: string): Row => ({ id, area });
const ids = (rows: readonly Row[]): string[] => rows.map((r) => r.id);
const areas = (rows: readonly Row[]): string[] => [...new Set(rows.map(areaGroupOf))];

describe('the areas, in alphabetical order', () => {
  it('orders Arabic names as the alphabet does — not by their code points', () => {
    // An alef with a hamza (أ U+0623, إ U+0625) comes before a bare alef (ا U+0627) by code
    // point, so code-point order puts «أكتوبر» and «إمبابة» ahead of every «ا» name. The alphabet
    // reads them all as alef and decides by the next letter: ب, ك, ل, م.
    const rows = [
      row('1', 'زايد'),
      row('2', 'إمبابة'),
      row('3', 'الدقي'),
      row('4', 'أكتوبر'),
      row('5', 'ابو رواش'),
    ];
    const alphabetical = ['ابو رواش', 'أكتوبر', 'الدقي', 'إمبابة', 'زايد'];
    expect(areas(groupRowsByArea(rows, 'asc'))).toEqual(alphabetical);
    expect(areas(groupRowsByArea(rows, 'desc'))).toEqual([...alphabetical].reverse());
    // What a plain string sort would have given — the order the boards must not show.
    expect(rows.map((r) => r.area).sort()).toEqual([
      'أكتوبر',
      'إمبابة',
      'ابو رواش',
      'الدقي',
      'زايد',
    ]);
  });

  it('runs Arabic names first, then Latin ones A → Z', () => {
    const rows = [
      row('1', 'MOHNDESSEN'),
      row('2', 'زايد'),
      row('3', 'alex'),
      row('4', 'الدقي'),
      row('5', 'Faisal'),
    ];
    expect(areas(groupRowsByArea(rows, 'asc'))).toEqual([
      'الدقي',
      'زايد',
      'alex',
      'Faisal',
      'MOHNDESSEN',
    ]);
  });

  it('puts a row with no area last, whichever way the areas run', () => {
    const rows = [row('1', ''), row('2', 'الدقي'), row('3', '   '), row('4', 'زايد')];
    expect(ids(groupRowsByArea(rows, 'asc'))).toEqual(['2', '4', '1', '3']);
    expect(ids(groupRowsByArea(rows, 'desc'))).toEqual(['4', '2', '1', '3']);
  });

  it('keeps each area’s rows in the order they came in', () => {
    const rows = [
      row('a', 'زايد'),
      row('b', 'الدقي'),
      row('c', 'زايد'),
      row('d', 'الدقي'),
      row('e', 'زايد'),
    ];
    expect(ids(groupRowsByArea(rows, 'asc'))).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(ids(groupRowsByArea(rows, 'desc'))).toEqual(['a', 'c', 'e', 'b', 'd']);
  });
});

describe('one area is one run of rows', () => {
  it('a spelling with surrounding spaces is the same area — as the filters treat it', () => {
    expect(areaGroupOf(row('1', '  الدقي '))).toBe('الدقي');
    const rows = [row('1', 'الدقي'), row('2', 'زايد'), row('3', ' الدقي ')];
    expect(ids(groupRowsByArea(rows, 'asc'))).toEqual(['1', '3', '2']);
  });

  it('a spelling with a double space inside is the same area — never split around another', () => {
    // A page collapses a double space, so two groups for it would read the same. Without the
    // fold, «EL  MAHALA» sorts before «EL AGOUZA» and «EL MAHALA» after it: one area in two places.
    expect(areaGroupOf(row('1', 'EL  MAHALA'))).toBe('EL MAHALA');
    expect(areaGroupOf(row('1', 'مدينة   نصر'))).toBe('مدينة نصر');
    const rows = [
      row('1', 'EL MAHALA'),
      row('2', 'EL  MAHALA'),
      row('3', 'EL AGOUZA'),
      row('4', ' EL MAHALA'),
    ];
    expect(ids(groupRowsByArea(rows, 'asc'))).toEqual(['3', '1', '2', '4']);
    expect(areas(groupRowsByArea(rows, 'asc'))).toEqual(['EL AGOUZA', 'EL MAHALA']);
  });

  it('a spelling the reader can tell apart stays its own area, beside its neighbour', () => {
    // Case is not folded (EG-6: an area is what was typed). The alphabet still puts the two side
    // by side, so nothing else comes between them.
    const rows = [
      row('1', 'Mohndessen'),
      row('2', 'ALEX'),
      row('3', 'MOHNDESSEN'),
      row('4', 'Faisal'),
    ];
    expect(areas(groupRowsByArea(rows, 'asc'))).toEqual([
      'ALEX',
      'Faisal',
      'Mohndessen',
      'MOHNDESSEN',
    ]);
  });

  it('two names that collate as equal still never interleave', () => {
    // NFC and NFD forms of one name collate as equal but are different strings. Each still makes
    // one unbroken run.
    const composed = 'Café';
    const decomposed = 'Café';
    expect(composed.localeCompare(decomposed, 'ar')).toBe(0);
    expect(compareAreas(composed, decomposed)).not.toBe(0);
    expect(compareAreas(composed, decomposed)).toBe(-compareAreas(decomposed, composed));
    const rows = [
      row('1', composed),
      row('2', decomposed),
      row('3', composed),
      row('4', decomposed),
    ];
    const grouped = groupRowsByArea(rows, 'asc').map(areaGroupOf);
    const runs = grouped.filter((area, i) => i === 0 || grouped[i - 1] !== area);
    expect(runs).toHaveLength(2);
  });
});

describe('the head’s arrows, and a click on them', () => {
  it('an untouched board shows the area first and ascending, and orders by nothing else', () => {
    expect(boardAreaOrder([])).toEqual({
      areaDir: 'asc',
      within: [],
      shown: [{ by: 'area', dir: 'asc' }],
    });
  });

  it('the reader’s column orders inside the areas, and shows after the area', () => {
    expect(boardAreaOrder([{ by: 'code', dir: 'desc' }])).toEqual({
      areaDir: 'asc',
      within: [{ by: 'code', dir: 'desc' }],
      shown: [
        { by: 'area', dir: 'asc' },
        { by: 'code', dir: 'desc' },
      ],
    });
    // Wherever `?sort=` names the area, it decides first.
    expect(
      boardAreaOrder([
        { by: 'code', dir: 'asc' },
        { by: 'area', dir: 'desc' },
      ]).shown,
    ).toEqual([
      { by: 'area', dir: 'desc' },
      { by: 'code', dir: 'asc' },
    ]);
  });

  it('a click on the area turns the areas round and back — it never lets go', () => {
    const once = clickBoardSort([], 'area');
    expect(once).toEqual([{ by: 'area', dir: 'desc' }]);
    // Ascending is the default and is not written.
    expect(clickBoardSort(once, 'area')).toEqual([]);
  });

  it('a click on the area keeps the reader’s column', () => {
    expect(clickBoardSort([{ by: 'opened', dir: 'asc' }], 'area')).toEqual([
      { by: 'area', dir: 'desc' },
      { by: 'opened', dir: 'asc' },
    ]);
  });

  it('a click elsewhere orders inside the areas — replace, turn round, let go — and keeps their direction', () => {
    const first = clickBoardSort([{ by: 'area', dir: 'desc' }], 'code');
    expect(first).toEqual([
      { by: 'area', dir: 'desc' },
      { by: 'code', dir: 'asc' },
    ]);
    const second = clickBoardSort(first, 'code');
    expect(second).toEqual([
      { by: 'area', dir: 'desc' },
      { by: 'code', dir: 'desc' },
    ]);
    expect(clickBoardSort(second, 'code')).toEqual([{ by: 'area', dir: 'desc' }]);
    // Another column replaces the first, as on every board.
    expect(clickBoardSort([{ by: 'code', dir: 'asc' }], 'opened')).toEqual([
      { by: 'opened', dir: 'asc' },
    ]);
  });
});

describe('the line above each area', () => {
  const t = (key: string): string => (key === 'atm.board.noArea' ? 'بدون منطقة' : key);

  it('names the area, or says it has none, and counts in the reader’s digits', () => {
    const line = areaGroupLine(t, 'ar');
    expect(line.of(row('1', ' الدقي '))).toBe('الدقي');
    expect(line.label('الدقي')).toBe('الدقي');
    expect(line.label('')).toBe('بدون منطقة');
    expect(line.count(12)).toBe('١٢');
    expect(areaGroupLine(t, 'en').count(12)).toBe('12');
  });
});
