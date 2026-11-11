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
// the ORDER — the filters read in the table's column order — and the van's code among them; and
// since «الفلاتر هتكون كلها على صف واحد» (and for the history «على نفس الصف»), the ONE ROW.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { boardFilterParams } from '../lib/day-board';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const BOARD = read('../components/ShipmentsBoard.tsx');
const DAY_PAGE = read('./DailyOperationsPage.tsx');
const HISTORY_PAGE = read('./ShipmentsHistoryPage.tsx');
const SECURED_PAGE = read('./SecuredBacklogPage.tsx');
const VAULT_PAGE = read('./VaultReceivePage.tsx');
const FLEET_BAR = read('../../../shared/ui/dark-filter-bar.ts');

/** The filter bar's own markup, from `<FilterBar` to its close — not the rest of the board. */
const BAR = BOARD.slice(BOARD.indexOf('<FilterBar'), BOARD.indexOf('</FilterBar>'));
/** A layout constant's classes, as written in the board — its quoted strings, comments left out. */
const layout = (name: string): string => {
  const start = BOARD.indexOf(`const ${name} =`);
  if (start < 0) return '';
  const source = BOARD.slice(start, BOARD.indexOf(';', start)).replace(/\/\/.*$/gm, '');
  return [...source.matchAll(/'([^']*)'/g)].map((m) => m[1]).join(' ');
};
/** Every screen's bar: the phone's two columns. */
const BAR_LAYOUT = layout('BAR_LAYOUT');
/** The history's bar (it has date pickers): two rows 1024–1279, one row from 1280. */
const PERIOD_BAR_LAYOUT = layout('PERIOD_BAR_LAYOUT');

/** Every control's name, in the order the bar draws them. */
const FILTERS = [
  'operations.board.vehicleCode',
  'operations.board.bank',
  'operations.shipment.origin',
  'operations.shipment.destination',
  'operations.shipment.area',
  'operations.board.captain',
  // The history's period — «من» and «إلى» — at the date column's place (the day board has none).
  'picker.label',
  'operations.shipment.type',
  // «الحالة» at the status column's place: the secured screen's stage box, or «التسليم».
  'operations.common.status',
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

  // «الفلاتر هتكون كلها على صف واحد». The day board's nine filters are the Fleet bar's own single
  // row from 1024px — every box an even share, the reset keeping its size at the row's end.
  it('puts the day board’s filters on ONE row from 1024px — the Fleet bar’s own row', () => {
    expect(FLEET_BAR).toContain('lg:[&>div]:!flex-nowrap');
    expect(FLEET_BAR).toContain('lg:[&>div>*]:!flex-1');
    expect(FLEET_BAR).toContain('lg:[&>div>.ms-auto]:!flex-none');
    // Nothing of the board's own overrides that row for a screen with no dates: the history's
    // layout is applied only where there are pickers, and the old two-row laptop grid is gone.
    expect(BOARD).toContain('datePickers.length > 0 && PERIOD_BAR_LAYOUT');
    expect(BOARD).not.toContain('max-[1599px]');
    expect(BAR_LAYOUT).not.toMatch(/\blg:/);
  });

  // «على نفس الصف» for the history too — from 1280px, where its eleven boxes fit: the two dates
  // keep a date's width (a date cut short is unreadable) and the nine others share the rest.
  it('puts the history’s filters on ONE row from 1280px, its two dates at their own width', () => {
    expect(PERIOD_BAR_LAYOUT).toContain('xl:[&>div>*:has(>input[type=date])]:!flex-none');
    // The date box's own width is the one that holds then: a date and its «من» / «إلى».
    expect(BAR).toMatch(/className=\{cn\(\s*'w-36 shrink-0',\s*picker\.showLabel === true/);
    // No grid survives past 1279: every grid rule of the history's is bounded to 1024–1279.
    const gridRules = PERIOD_BAR_LAYOUT.split(' ').filter((rule) => rule.includes('grid'));
    expect(gridRules.length).toBeGreaterThan(0);
    for (const rule of gridRules) expect(rule.startsWith('lg:max-xl:'), rule).toBe(true);
  });

  it('keeps the history to two rows of even columns between 1024 and 1279', () => {
    // A row of eleven shares is narrower than a date there: a grid of six columns, the reset in a
    // column of its own spanning both rows.
    expect(PERIOD_BAR_LAYOUT).toContain('lg:max-xl:[&>div]:!grid-cols-6');
    expect(PERIOD_BAR_LAYOUT).toContain('lg:max-xl:[&>div>.ms-auto]:!row-span-2');
    // The reset's column is made by its own placement — no spare column for a filter to fall into
    // while there is nothing to reset.
    expect(BOARD).not.toMatch(/grid-cols-\[repeat\(\d,minmax\(0,1fr\)\)_auto\]/);
    expect(PERIOD_BAR_LAYOUT).toContain('lg:max-xl:[&>div>.ms-auto]:!col-start-7');
  });

  it('keeps the phone’s two even columns', () => {
    expect(BAR_LAYOUT).toContain('max-sm:[&>div]:!grid-cols-2');
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
    // (تاريخ التسليم — the secured screen's) | النوع | الحالة | ملاحظات — the amount and the delivery
    // date have nothing to type, and the status column is filtered by «التسليم» or the stage.
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
      'deliveryDate',
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

  it('gives every date picker a name — «من» and «إلى»', () => {
    expect(HISTORY_PAGE).toContain("label: t('operations.history.from')");
    expect(HISTORY_PAGE).toContain("label: t('operations.history.to')");
    // The day board has no picker to name: «هنشيل منها التاريخ»; nor has the secured screen,
    // which is every open محصنة whatever its dates.
    expect(DAY_PAGE).not.toContain('datePickers');
    expect(SECURED_PAGE).not.toContain('datePickers');
    // Nor the vault's receive queue: what is outstanding, and today's receipts — no dates to pick.
    expect(VAULT_PAGE).not.toContain('datePickers');
  });
});

describe('clearing returns the whole view to its default', () => {
  it('offers the reset once anything narrows the board — filters OR a period not the default', () => {
    // `hasActiveFilter` was exported by `lib/day-board.ts` from the start and never wired to
    // anything; the bar is what finally uses it.
    expect(BAR).toContain('hasActiveFilters={hasActiveFilter(filters) || periodActive}');
    // The day board's period is always today — never "not the default", so only filters reset.
    expect(BOARD).toContain('periodActive = false,');
    expect(DAY_PAGE).not.toContain('periodActive');
    expect(HISTORY_PAGE).toContain(
      "periodActive={sp.get('from') !== null || sp.get('to') !== null}",
    );
  });

  it('clears the period as well, in the same write as the filters', () => {
    // EVERY filter param — the status param the board does not offer too, so a stale one is gone.
    expect(BAR).toContain(
      'for (const name of [...DAY_BOARD_FILTER_PARAMS, ...periodParams]) next.delete(name);',
    );
    expect(BOARD).toContain('periodParams = [],');
    expect(DAY_PAGE).not.toContain('periodParams');
    expect(HISTORY_PAGE).toContain("periodParams={['from', 'to']}");
  });
});

describe('every screen remembers the filters its board reads, and only those', () => {
  /** A page's own `REMEMBERED_FILTERS`, as the persistence census reads it. */
  const remembered = (source: string): string[] => {
    const block = /const REMEMBERED_FILTERS = \[([^\]]*)\] as const;/.exec(source);
    return [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  };

  it('remembers every filter the board reads — the van too — and never the period', () => {
    // A filter the board reads but a page does not remember is one that silently resets on the
    // next visit; one a page remembers but the board does not read is a dead entry.
    expect(remembered(DAY_PAGE)).toEqual([...boardFilterParams('shipments')]);
    expect(remembered(HISTORY_PAGE)).toEqual([...boardFilterParams('shipments')]);
    // The secured screen filters by stage in «التسليم»'s place, and has no «النوع» — and so does
    // the vault's receive queue, drawn as the secured board.
    expect(remembered(SECURED_PAGE)).toEqual([...boardFilterParams('secured')]);
    expect(VAULT_PAGE).toContain('kind="secured"');
    expect(remembered(VAULT_PAGE)).toEqual([...boardFilterParams('secured')]);
  });

  it('reads only the filters the screen offers — a param with no box never narrows it', () => {
    // …nor a stage its «الحالة» box does not offer (`stages` — the vault queue's depend on «الكل»).
    expect(BOARD).toContain(
      'const filters = offeredFilters(readDayBoardFilters(sp), kind, stages);',
    );
    expect(BOARD).toContain("kind = 'shipments',");
    expect(BOARD).toContain('stages = SECURED_SCREEN_STAGES,');
    expect(BAR).toContain('options={stages.map((stage) => ({');
  });

  it('draws no «النوع» on the secured screen, and the stage box in «التسليم»’s place', () => {
    expect(BAR).toMatch(
      /\{!secured && \(\s*<FilterWithIcon[^>]*>\s*<MultiSelect[\s\S]*?label=\{t\('operations\.shipment\.type'\)\}/,
    );
    expect(BAR).toMatch(
      /\{secured \? \(\s*<FilterWithIcon[^>]*>\s*<MultiSelect[\s\S]*?label=\{t\('operations\.common\.status'\)\}/,
    );
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
