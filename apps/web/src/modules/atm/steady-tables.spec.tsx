// Every ATM table keeps its columns' widths while it is filtered, and every time in it stays on one
// line (2026-11-03): «عرض الأعمدة فى الجدول بيتغير لما بعمل فلتر !! عايزك تثبته .. وحافظ على الوقت
// يظهر بالعرض كامل مش تحت بعض بردو فى كل الجداول».
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { translate } from '../../platform/localization/i18n';
import { LiveTimerCell } from './components/LiveTimer';
import { RunChip } from './components/settlements/RunChip';
import { COPY_COLUMN_CLASS } from './lib/board-copy';
import { maintenanceColumns, replenishmentColumns, sheetColumnClass } from './lib/operation-sheet';
import { TIME_CELL_CLASS } from './lib/operation-view';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(here, path), 'utf8');

/** Every screen file of the module, by its path inside it. */
const screens = (dir = here): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return screens(path);
    return name.endsWith('.tsx') && !name.includes('.spec.') ? [relative(here, path)] : [];
  });

/** Each `<DataTable …/>` of a file — from its name to the `/>` under it. */
const dataTables = (source: string): string[] =>
  [...source.matchAll(/^( *)<DataTable\b/gm)].map((match) => {
    const end = source.indexOf(`\n${match[1] ?? ''}/>`, match.index);
    return source.slice(match.index, end === -1 ? undefined : end);
  });

describe('the columns keep their widths', () => {
  const withTables = screens().filter((path) => read(path).includes('<DataTable'));

  it('finds the module’s tables — the boards, the done pages, the mail, the layouts, the register', () => {
    expect(withTables.length).toBeGreaterThanOrEqual(12);
    expect(withTables).toContain('pages/ReplenishmentsPage.tsx');
    expect(withTables).toContain('pages/MaintenancePage.tsx');
  });

  it.each(withTables)('on every table of %s', (path) => {
    const tables = dataTables(read(path));
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(table).toMatch(/^\s*steadyColumns$/m);
  });

  // The tables built by hand that a column's list filters: control, the plan, preparation.
  const byHand = screens().filter((path) => {
    const source = read(path);
    return source.includes('<ColumnFilterSelect') && source.includes('<table');
  });

  it('finds the filtered tables built by hand', () => {
    expect(byHand.sort()).toEqual([
      'components/settlements/ControlDataTab.tsx',
      'components/settlements/PlanLinesTable.tsx',
      'pages/PreparationPage.tsx',
    ]);
  });

  it.each(byHand)('and on %s', (path) => {
    const source = read(path);
    expect(source).toContain('useSteadyColumns({');
    expect(source).toContain('ref={steady.ref}');
    expect(source).toContain('<SteadyColGroup shares={steady.shares} />');
    // Widths taken while a column's list narrows the lines are provisional.
    expect(source).toMatch(/filtered(: columnFilters\.active)?,/);
  });

  it('control and the plan keep their widths in the PAGE, so a table drawn again finds them', () => {
    // Control's data table is drawn again after the routes tab, the plan's after a bank or a day
    // loads; the widths live beside the column filters, which outlast both.
    const control = read('pages/ControlPage.tsx');
    expect(control).toContain('useControlLineWidths({');
    expect(control).toContain('steady={lineWidths}');
    const plan = read('pages/SettlementPlanPage.tsx');
    expect(plan).toContain('usePlanLineWidths({');
    expect(plan).toContain('steady={lineWidths}');
  });

  // A page that remembers its filters can open on a few rows: it tells the table, whose widths are
  // then provisional until the first draw with no filter on.
  it.each([
    ['pages/ReplenishmentsPage.tsx', 'filtered={filters.filtered}'],
    ['pages/MaintenancePage.tsx', 'filtered={filters.filtered}'],
    ['pages/MailTicketsPage.tsx', 'filtered={isMailFiltered(filters)}'],
    ['pages/MailLogPage.tsx', 'filtered={isMailFiltered(filters, status)}'],
    ['pages/MachinesPage.tsx', 'filtered={filtered}'],
    ['pages/DataEditPage.tsx', "filtered={active !== '' || search !== ''}"],
    ['pages/CassetteLayoutsPage.tsx', "filtered={status !== 'all' || query.trim() !== ''}"],
    ['pages/LayoutImportPage.tsx', 'filtered={outcome !== null}'],
  ])('%s says when its own filters narrow the rows', (path, prop) => {
    expect(read(path)).toContain(prop);
  });
});

describe('a time stays on one line', () => {
  const t = (key: string): string => translate('ar', key);
  const times = (columns: { key: string; time?: boolean }[]): string[] =>
    columns.filter((column) => column.time === true).map((column) => column.key);

  it('the schedule and the open time on the boards, and the open, close and taken times on the done pages', () => {
    expect(times(replenishmentColumns(t, 'ar', 'open'))).toEqual(['schedule', 'opened']);
    expect(times(maintenanceColumns(t, 'ar', 'open'))).toEqual(['opened']);
    expect(times(replenishmentColumns(t, 'ar', 'done'))).toEqual([
      'schedule',
      'opened',
      'closed',
      'duration',
    ]);
    expect(times(maintenanceColumns(t, 'ar', 'done'))).toEqual(['opened', 'closed', 'duration']);
  });

  it('a column’s cells carry the class for what it is — a copy column, a time, or neither', () => {
    expect(TIME_CELL_CLASS).toBe('whitespace-nowrap');
    expect(sheetColumnClass({ time: true })).toEqual({ className: TIME_CELL_CLASS });
    expect(sheetColumnClass({ copy: true })).toEqual({ className: COPY_COLUMN_CLASS });
    expect(sheetColumnClass({})).toEqual({});
    // The board's schedule is both: copied, and a time.
    expect(sheetColumnClass({ copy: true, time: true })).toEqual({
      className: `${COPY_COLUMN_CLASS} ${TIME_CELL_CLASS}`,
    });
  });

  it.each([
    'pages/ReplenishmentsPage.tsx',
    'pages/MaintenancePage.tsx',
    'pages/ReplenishmentsDonePage.tsx',
    'pages/MaintenanceDonePage.tsx',
  ])('on %s, through the sheet’s columns', (path) => {
    expect(read(path)).toContain('...sheetColumnClass(column),');
  });

  it('the live timer — «00h : 03m : 42s» never stacked over three lines', () => {
    const html = renderToStaticMarkup(
      <LiveTimerCell openedAt="2026-11-03T08:00:00.000Z" now={new Date('2026-11-03T08:03:42Z')} />,
    );
    expect(html).toContain('00h : 03m : 42s');
    expect(html).toContain(TIME_CELL_CLASS);
  });

  it('a run’s time on control, the plan and preparation — «10:15 ص» never split after its digits', () => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer },
      preloadedState: { locale: { locale: 'ar' as Locale, dir: 'rtl' as const } },
    });
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <RunChip run={1} time="10:15" locale="ar" />
      </Provider>,
    );
    const time = /<span dir="ltr" class="([^"]*)">([^<]*)<\/span>/.exec(html);
    expect(time?.[1]).toContain(TIME_CELL_CLASS);
    expect(time?.[2]).not.toBe('');
  });

  it('the mail’s received and action times, and a layout’s change time', () => {
    const count = (source: string): number =>
      source.split('className: TIME_CELL_CLASS,').length - 1;
    expect(count(read('pages/MailTicketsPage.tsx'))).toBe(1);
    expect(count(read('pages/MailLogPage.tsx'))).toBe(2);
    expect(read('pages/CassetteLayoutsPage.tsx')).toContain('<span className={TIME_CELL_CLASS}>');
  });
});
