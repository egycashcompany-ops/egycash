// The shipments board's filter bar — the day board's and the history's, drawn by one component
// (`components/ShipmentsBoard.tsx`). Eight controls in a stacked-label grid once took TWO rows of
// labels and boxes, which pushed the table itself below the fold on a laptop — the one thing the
// screen exists to show.
//
// The bar is the shape the Fleet boards settled on: the dark bar, a FilterBar, each control in a
// `FilterWithIcon` that sizes it. What that costs is the visible label above each box, and the
// risk that comes with it is losing the control's NAME rather than just its pixels. These cases
// hold that line: a filter with no visible label and no `aria-label` is a box nobody can identify,
// by eye or by screen reader.
//
// Since «انا عاوز ارتب الفلاتر على حسب عواميد الجدول وضيف كود العربيه ف الفلاتر» they also hold
// the ORDER — the filters read in the table's column order — and the van's code among them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DAY_BOARD_FILTER_PARAMS } from '../lib/day-board';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const BOARD = read('../components/ShipmentsBoard.tsx');
const DAY_PAGE = read('./DailyOperationsPage.tsx');
const HISTORY_PAGE = read('./ShipmentsHistoryPage.tsx');

/** The filter bar's own markup, from `<FilterBar` to its close — not the rest of the board. */
const BAR = BOARD.slice(BOARD.indexOf('<FilterBar'), BOARD.indexOf('</FilterBar>'));

/** Every control's name, in the order the bar draws them. */
const FILTERS = [
  'operations.board.vehicleCode',
  'operations.board.bank',
  'operations.shipment.origin',
  'operations.shipment.destination',
  'operations.shipment.area',
  'operations.board.captain',
  // The page's period — the day, or «من» and «إلى» — at the date column's place.
  'picker.label',
  'operations.shipment.type',
  'operations.dailyOps.received',
  'operations.shipment.notes',
];
/** Where a control's name is first written in the bar. */
const at = (key: string): number => {
  const named = key === 'picker.label' ? 'aria-label={picker.label}' : `label={t('${key}')}`;
  return BAR.indexOf(named);
};

describe('the filters sit on the Fleet bar', () => {
  it('uses the shared FilterBar, not a stacked grid of labels', () => {
    expect(BOARD).toContain('<FilterBar');
    // The grid that produced the second row: four columns and eight controls.
    expect(BOARD).not.toContain('lg:grid-cols-4');
  });

  it('carries no stacked label above a control', () => {
    expect(BAR).not.toContain('mb-1 block');
  });

  it('sizes each text filter with a wrapper, since the control base class is w-full', () => {
    // `cn` has no tailwind-merge, so a width passed to the Input loses to its own `w-full` and
    // every box would stretch the bar — one filter per line, which is the bug being fixed.
    // The width may be the first class of a `cn(…)` (the history's dates add a size container).
    const sized =
      BAR.match(/className=(?:"w-\d+ shrink-0"|\{cn\(\s*'w-\d+ shrink-0')[^>]*>\s*<Input/g) ?? [];
    const inputs = BAR.match(/<Input\b/g) ?? [];
    // Seven typed boxes (the van, the bank, the two branches, the area, the captain, the notes)
    // and the date box the period's pickers are drawn with.
    expect(inputs.length).toBe(8);
    expect(sized.length).toBe(inputs.length);
  });

  it('wears the Fleet boards’ dark bar', () => {
    expect(BOARD).toContain('DARK_FILTER_BAR');
    expect(BAR).toContain('<FilterWithIcon');
  });

  it('keeps to two rows of even columns on a laptop, one row from 1600px', () => {
    // A row of ten shares is ~93px at 1366 — narrower than a date. Up to 1599px the bar is a grid
    // of half the filters per row, with the reset in its own column spanning both rows.
    expect(BOARD).toContain('lg:max-[1599px]:[&>div]:!grid');
    expect(BOARD).toContain('lg:max-[1599px]:[&>div]:!grid-cols-5');
    // The history (eleven filters) keeps two rows at every width from 1024px: its dates write
    // «من» and «إلى» in the box, which a share of a single row of eleven has no room for.
    expect(BOARD).toContain('lg:[&>div]:!grid-cols-6');
    expect(BOARD).toContain('lg:[&>div>.ms-auto]:!row-span-2');
    expect(BOARD).toContain('[&>div>.ms-auto]:!row-span-2');
    // The reset's column is made by its own placement — no spare column for a filter to fall into
    // while there is nothing to reset.
    expect(BOARD).not.toMatch(/grid-cols-\[repeat\(\d,minmax\(0,1fr\)\)_auto\]/);
    expect(BOARD).toContain('lg:max-[1599px]:[&>div>.ms-auto]:!col-start-6');
    expect(BOARD).toContain('lg:[&>div>.ms-auto]:!col-start-7');
    // A phone: two even columns.
    expect(BOARD).toContain('max-sm:[&>div]:!grid-cols-2');
  });
});

describe('«ارتب الفلاتر على حسب عواميد الجدول» — the column order', () => {
  it('draws every filter, in the order of the table’s columns', () => {
    const positions = FILTERS.map(at);
    for (const [index, key] of FILTERS.entries()) {
      expect(positions[index], `${key} is not in the bar`).toBeGreaterThanOrEqual(0);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('is the order of the columns themselves', () => {
    // السيارة | اسم البنك | من فرع | إلى فرع | المنطقة | (قيمة الشحنة) | قائد الطاقم | التاريخ |
    // النوع | الحالة | ملاحظات — the amount has nothing to type, and the status column is
    // filtered by «التسليم».
    const columns = [...BOARD.matchAll(/^ {6}key: '(\w+)',$/gm)].map((m) => m[1]);
    expect(columns).toEqual([
      'vehicle',
      'bank',
      'origin',
      'destination',
      'area',
      'amount',
      'captain',
      'date',
      'type',
      'status',
      'notes',
      'receiptImage',
      'actions',
    ]);
  });

  it('reads the van’s code first, as the «السيارة» column is first', () => {
    expect(BAR).toContain('icon={FILTER_ICON.car}');
    expect(BAR).toContain('value={filters.vehicle}');
    expect(BAR).toContain('setFilter({ vehicle: e.target.value })');
    // The rows are filtered by the van of the row's leg.
    expect(BOARD).toContain("(row) => row.crew?.vehicleCode ?? ''");
  });
});

describe('nothing lost its name when the labels went', () => {
  it('names every control to a screen reader', () => {
    for (const key of FILTERS) {
      // A MultiSelect's `label` is its trigger's `aria-label`.
      const named =
        key === 'picker.label'
          ? BAR.includes('aria-label={picker.label}')
          : BAR.includes(`aria-label={t('${key}')}`) || BAR.includes(`label={t('${key}')}`);
      expect(named, key).toBe(true);
    }
  });

  it('names every control on screen too — as a placeholder, or the picker’s own label', () => {
    for (const key of FILTERS) {
      const shown =
        key === 'picker.label'
          ? // A date input renders its own format hint and ignores `placeholder`; `title` is
            // what survives the hover.
            BAR.includes('title={picker.label}')
          : BAR.includes(`placeholder={t('${key}')}`) ||
            // A MultiSelect writes its label in the empty trigger.
            BAR.includes(`label={t('${key}')}`);
      expect(shown, key).toBe(true);
    }
  });

  it('gives every date picker a name — the day, «من» and «إلى»', () => {
    expect(DAY_PAGE).toContain("label: t('operations.dailyOps.date')");
    expect(HISTORY_PAGE).toContain("label: t('operations.history.from')");
    expect(HISTORY_PAGE).toContain("label: t('operations.history.to')");
  });
});

describe('clearing returns the whole view to its default', () => {
  it('offers the reset once anything narrows the board — filters OR a period not the default', () => {
    // `hasActiveFilter` was exported by `lib/day-board.ts` from the start and never wired to
    // anything; the bar is what finally uses it.
    expect(BAR).toContain('hasActiveFilters={hasActiveFilter(filters) || periodActive}');
    expect(DAY_PAGE).toContain('periodActive={date !== null}');
    expect(HISTORY_PAGE).toContain(
      "periodActive={sp.get('from') !== null || sp.get('to') !== null}",
    );
  });

  it('clears the period as well, in the same write as the filters', () => {
    expect(BAR).toContain(
      'for (const name of [...DAY_BOARD_FILTER_PARAMS, ...periodParams]) next.delete(name);',
    );
    expect(DAY_PAGE).toContain("periodParams={['date']}");
    expect(HISTORY_PAGE).toContain("periodParams={['from', 'to']}");
  });
});

describe('both screens remember the same filters, and only those', () => {
  /** A page's own `REMEMBERED_FILTERS`, as the persistence census reads it. */
  const remembered = (source: string): string[] => {
    const block = /const REMEMBERED_FILTERS = \[([^\]]*)\] as const;/.exec(source);
    return [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  };

  it('remembers every filter the board reads — the van too — and never the period', () => {
    // A filter the board reads but a page does not remember is one that silently resets on the
    // next visit; one a page remembers but the board does not read is a dead entry.
    expect(remembered(DAY_PAGE)).toEqual([...DAY_BOARD_FILTER_PARAMS]);
    expect(remembered(HISTORY_PAGE)).toEqual([...DAY_BOARD_FILTER_PARAMS]);
  });
});

describe('the history’s refusal replaces the rows and the figures together', () => {
  // A refetch the server refuses (the range passed the cap after a save) leaves the query holding
  // its LAST answer beside the error. The pills must not go on summing that answer above a message
  // saying the range was refused — the rows, the crews and the figures all wait on the same test.
  it('feeds the board nothing while a refusal shows', () => {
    expect(HISTORY_PAGE).toContain('const tooLarge = isHistoryTooLarge(history.error);');
    expect(HISTORY_PAGE).toContain('const answered = problem === null && !tooLarge;');
    expect(HISTORY_PAGE).toContain('shipments={answered ? (history.data?.shipments ?? []) : []}');
    expect(HISTORY_PAGE).toContain('crews={answered ? (history.data?.crews ?? []) : []}');
    expect(HISTORY_PAGE).toContain('loaded={answered && history.data !== undefined}');
    expect(HISTORY_PAGE).toContain('loading={answered && history.isLoading}');
  });
});
