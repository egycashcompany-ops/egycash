// What a click on a header does — the rule, driven as a function.
//
// «لو دوس على الكود ... لكن لو دوس على انتهاء الترخيص هيلغى اللى كنت عامله فى الكود ... انا عاوز
// اقدر اعمل الاتنين مع بعض». The defect was not that the sort was wrong; it was that the table
// could only hold ONE answer, so every new question threw away the last one.
import { describe, expect, it } from 'vitest';
import { FLEET_SORT_MAX } from '@ecms/contracts';
import {
  clickSort,
  readSorts,
  sortQuery,
  toggleSort,
  writeSorts,
  type TableSort,
} from './table-sort';

/** The order as a reader would describe it: «code ascending, then expiry descending». */
const said = (sorts: readonly TableSort[]): string[] => sorts.map((s) => `${s.by}:${s.dir}`);

describe('clicking a column the table is not sorted by', () => {
  it('ADDS it, ascending, keeping what was there', () => {
    // THE WHOLE POINT. The second column used to replace the first.
    const after = toggleSort([{ by: 'code', dir: 'asc' }], 'licenseExpiresAt');
    expect(said(after)).toEqual(['code:asc', 'licenseExpiresAt:asc']);
  });

  it('adds it at the END, so the first column clicked stays the first column sorted', () => {
    let sorts: TableSort[] = [];
    sorts = toggleSort(sorts, 'code');
    sorts = toggleSort(sorts, 'licenseExpiresAt');
    sorts = toggleSort(sorts, 'createdAt');
    expect(said(sorts)).toEqual(['code:asc', 'licenseExpiresAt:asc', 'createdAt:asc']);
  });

  it('starts ascending — «من الاصغر للاكبر», which is what the reader described', () => {
    expect(said(toggleSort([], 'code'))).toEqual(['code:asc']);
  });
});

describe('clicking a column the table is already sorted by', () => {
  it('turns it round the first time, in place — the other columns do not move', () => {
    const sorts: TableSort[] = [
      { by: 'code', dir: 'asc' },
      { by: 'licenseExpiresAt', dir: 'asc' },
    ];
    expect(said(toggleSort(sorts, 'code'))).toEqual(['code:desc', 'licenseExpiresAt:asc']);
  });

  it('takes it OUT the second time, leaving the rest of the order alone', () => {
    const sorts: TableSort[] = [
      { by: 'code', dir: 'desc' },
      { by: 'licenseExpiresAt', dir: 'asc' },
    ];
    expect(said(toggleSort(sorts, 'code'))).toEqual(['licenseExpiresAt:asc']);
  });

  it('is a THREE-step cycle, and the third step is the way back out', () => {
    let sorts = toggleSort([], 'code');
    expect(said(sorts)).toEqual(['code:asc']);
    sorts = toggleSort(sorts, 'code');
    expect(said(sorts)).toEqual(['code:desc']);
    sorts = toggleSort(sorts, 'code');
    expect(said(sorts)).toEqual([]);
  });

  it('never MUTATES the order it was handed — a click is a new order, not an edit', () => {
    const sorts: TableSort[] = [{ by: 'code', dir: 'asc' }];
    const before = JSON.stringify(sorts);
    toggleSort(sorts, 'code');
    toggleSort(sorts, 'licenseExpiresAt');
    expect(JSON.stringify(sorts)).toBe(before);
  });
});

describe('the cap', () => {
  it('drops the OLDEST column rather than refusing the click', () => {
    let sorts: TableSort[] = [];
    for (const key of ['a', 'b', 'c', 'd', 'e']) sorts = toggleSort(sorts, key);
    expect(sorts).toHaveLength(FLEET_SORT_MAX);
    expect(said(sorts)[0], 'the first click has aged out').toBe('b:asc');
    expect(said(sorts).at(-1)).toBe('e:asc');
  });
});

describe('the address bar', () => {
  it('reads an order back exactly as it was written', () => {
    const sorts: TableSort[] = [
      { by: 'code', dir: 'asc' },
      { by: 'licenseExpiresAt', dir: 'desc' },
    ];
    expect(readSorts(writeSorts(sorts), 'code:asc')).toEqual(sorts);
  });

  it('falls back to the screen’s own default when there is no parameter', () => {
    expect(said(readSorts(null, 'inDate:desc'))).toEqual(['inDate:desc']);
    expect(said(readSorts('', 'name.ar:asc')), 'and for an empty one').toEqual(['name.ar:asc']);
  });

  it('takes the reader back to that default when they clear the last column', () => {
    // A table is never sorted by NOTHING: the third click on a lone column lands back on the
    // order the screen opens with, which is where the reader started.
    const cleared = toggleSort([{ by: 'code', dir: 'desc' }], 'code');
    expect(writeSorts(cleared)).toBeNull();
    expect(said(readSorts(writeSorts(cleared), 'code:asc'))).toEqual(['code:asc']);
  });

  it('survives a hand-edited parameter instead of emptying the table', () => {
    expect(said(readSorts('nonsense!!', 'code:asc'))).toEqual(['code:asc']);
    expect(said(readSorts('code', 'createdAt:desc')), 'a bare field means ascending').toEqual([
      'code:asc',
    ]);
  });
});

describe('what the request carries', () => {
  it('sends the whole order AND the first column in the platform’s own two fields', () => {
    const sorts: TableSort[] = [
      { by: 'code', dir: 'asc' },
      { by: 'licenseExpiresAt', dir: 'desc' },
    ];
    expect(sortQuery(sorts)).toEqual({
      sortBy: 'code',
      sortDir: 'asc',
      sort: 'code:asc,licenseExpiresAt:desc',
    });
  });

  it('asks for nothing at all when the order is empty, rather than an empty string', () => {
    // `sortBy: ''` would reach the server as a field no collection has; `undefined` is dropped
    // from the query altogether and the collection's own default answers.
    expect(sortQuery([])).toEqual({ sortBy: undefined, sortDir: undefined, sort: undefined });
  });

  it('is what a single-column screen sent before, unchanged', () => {
    expect(sortQuery([{ by: 'occurredAt', dir: 'desc' }])).toMatchObject({
      sortBy: 'occurredAt',
      sortDir: 'desc',
    });
  });
});

// ── the FIRST click, against the screen's own default ───────────────────────
//
// «النوع بدوس عليه بيحدد الكود برضو وانا مجتش جمبه». A screen opens on an order it chose for
// itself; the reader did not click it, and a click on something else must not be read as «and
// also». What makes this worth its own rule is that `toggleSort` cannot see the difference — it
// is handed a list either way.

describe('the first click, when the reader has ordered nothing yet', () => {
  it('REPLACES the screen’s default instead of joining it', () => {
    // The registry opens on the code. Clicking «النوع» is a new question, not a refinement of a
    // question nobody asked: the code lets go, and only the make is marked.
    expect(said(clickSort(null, 'code:asc', 'typeName'))).toEqual(['typeName:asc']);
  });

  it('turns the default’s own column round, which is what its arrow promises', () => {
    // «الكود» is drawn ascending on an untouched registry, so a click on it must flip it — not
    // add an ascending code to an ascending code.
    expect(said(clickSort(null, 'code:asc', 'code'))).toEqual(['code:desc']);
    expect(said(clickSort(null, 'date:desc', 'date'))).toEqual(['date:asc']);
  });

  it('frees a table whose default is a column the reader cannot even see', () => {
    // The drivers registry opens on «تاريخ الإضافة» and the workshop on the check-in date. Joined
    // rather than replaced, the invisible column decided and the clicked one only broke its ties
    // — a click that marked a column, sent an order, and changed nothing on the screen.
    expect(said(clickSort(null, 'createdAt:desc', 'driver'))).toEqual(['driver:asc']);
    expect(said(clickSort(null, 'inDate:desc', 'vehicleCode'))).toEqual(['vehicleCode:asc']);
  });

  it('keeps piling columns up once the reader HAS ordered something', () => {
    // The multi-column behaviour is about the reader's own columns, and it is untouched.
    expect(said(clickSort('typeName:asc', 'code:asc', 'code'))).toEqual([
      'typeName:asc',
      'code:asc',
    ]);
    expect(said(clickSort('typeName:asc,code:asc', 'code:asc', 'typeName'))).toEqual([
      'typeName:desc',
      'code:asc',
    ]);
  });

  it('lets the reader empty the order and start again from the default', () => {
    // Third click drops the column; with nothing left the screen is back on its own default, and
    // the NEXT click is a first click again rather than an append to an empty list.
    const emptied = clickSort('typeName:desc', 'code:asc', 'typeName');
    expect(said(emptied)).toEqual([]);
    expect(said(clickSort(writeSorts(emptied), 'code:asc', 'licenseExpiresAt'))).toEqual([
      'licenseExpiresAt:asc',
    ]);
  });

  it('reads a hand-edited parameter as no order at all, not as a broken one', () => {
    expect(said(clickSort('@@@', 'code:asc', 'typeName'))).toEqual(['typeName:asc']);
  });
});
