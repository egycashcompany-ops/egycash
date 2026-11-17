// «فى شاشات الـ IT مش عايز كل الصفحة تعمل Scroll !! عايز فقط الجدول لكن الزراير والفلتر يبقوا
// ثابتين» (2026-11-17): every IT screen built around a list takes the board frame Fleet's and ATM's
// screens already have (`shared/ui/board-scroll.ts`). On a computer the title and its buttons, the
// figures, the filters and any selection bar keep their place above, the pager keeps its place
// below, and only the table's rows scroll, under a head that stays.
//
// Read from each page's own code with the comments left out, as the Fleet screens' specs read
// theirs: a frame named only in prose must not keep this green. The pieces, per page:
//   · `<PageContainer fullHeight>` — the page fills the screen's height instead of growing;
//   · a `BOARD_FRAME` column holding the board;
//   · the table in a `BOARD_TABLE_FILL_LOW` wrapper, as its DIRECT child (the wrapper's `[&>div]`
//     is the DataTable's own scroll box), drawn with `stickyHead` — Fleet's and ATM's
//     `BOARD_TABLE_FILL` with a lower floor, so on a laptop's short screen under a tall filter bar
//     the rows shrink before the filters move;
//   · the pager inside the frame AFTER that wrapper — kept in view below the rows, not scrolled
//     away under them.
//
// The dashboards and the records — the IT home, the vehicle checks, an asset's, a licence's, an
// order's, a ticket's page, a person's history — are not lists. They keep growing down the page,
// and none of them takes the full-height frame, which would squeeze a dashboard into one screen.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOARD_TABLE_FILL, BOARD_TABLE_FILL_LOW } from '../../../shared/ui/board-scroll';

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * A file's code, comments stripped. The whole-line `//` comments go first: one may name a glob
 * (`lib/*-export.ts`), and taken for the start of a block comment it would swallow real code.
 */
const code = (rel: string): string =>
  readFileSync(join(HERE, rel), 'utf8')
    .replace(/^\s*\/\/.*$/gmu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '');

/** The list screens, by file — each one a board. */
const BOARDS = [
  'AssetsListPage.tsx',
  'CustodyPage.tsx',
  'ConsumablesPage.tsx',
  'ConsumableMovementsPage.tsx',
  'MobileLinesPage.tsx',
  'ItEmployeesPage.tsx',
  'ItCatalogsPage.tsx',
  'VendorsPage.tsx',
  'LicensesPage.tsx',
  'SoftwarePage.tsx',
  'TicketsListPage.tsx',
  'MaintenanceOrdersPage.tsx',
  'MaintenancePlansPage.tsx',
  'SparePartsPage.tsx',
] as const;

/** The bulk upload: its preview's lines scroll in a box of their own (its own case, below). */
const IMPORT_PAGE = 'AssetsImportPage.tsx';
const IMPORT_PREVIEW = '../components/AssetImportPreview.tsx';

/** Dashboards and records: no list table, so no full-height frame. */
const NOT_BOARDS = [
  'ItHomePage.tsx',
  'VehicleChecksPage.tsx',
  'AssetDetailPage.tsx',
  'AssetScanPage.tsx',
  'LicenseDetailPage.tsx',
  'MaintenanceOrderDetailPage.tsx',
  'TicketDetailPage.tsx',
  'ItEmployeeHistoryPage.tsx',
  // A settings page: two settings cards above a table of three to five priorities — pinned, the
  // cards would leave that table no room on a laptop (measured), and there is nothing to scroll.
  'HelpDeskSettingsPage.tsx',
] as const;

/**
 * The `<div …>…</div>` that opens at `start`, whole — its nested divs counted, so the range ends
 * at ITS closing tag. `null` when the tags never balance.
 */
const divAt = (source: string, start: number): { start: number; end: number } | null => {
  const tags = /<div\b|<\/div>/gu;
  tags.lastIndex = start;
  let depth = 0;
  for (let m = tags.exec(source); m !== null; m = tags.exec(source)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return { start, end: m.index + m[0].length };
  }
  return null;
};

/** Every div whose `className` expression names `token` — the frames, or the fill wrappers. */
const divsNaming = (source: string, token: string): { start: number; end: number }[] =>
  [...source.matchAll(new RegExp(`<div className=\\{[^{}]*\\b${token}\\}`, 'gu'))].map((m) => {
    const range = divAt(source, m.index);
    expect(range, `${token} at ${m.index} never closes`).not.toBeNull();
    return range!;
  });

const PAGER = /<(?:Pagination|NumberedPager)\b/gu;

describe('IT boards: only the table scrolls («عايز فقط الجدول لكن الزراير والفلتر يبقوا ثابتين»)', () => {
  it.each(BOARDS)('%s fills the screen and frames its board', (page) => {
    const source = code(page);
    expect(source).toContain('<PageContainer fullHeight>');
    expect(source).toMatch(
      /import \{[^}]*\bBOARD_FRAME\b[^}]*\} from '\.\.\/\.\.\/\.\.\/shared\/ui\/board-scroll';/u,
    );
    expect(source).toMatch(
      /import \{[^}]*\bBOARD_TABLE_FILL_LOW\b[^}]*\} from '\.\.\/\.\.\/\.\.\/shared\/ui\/board-scroll';/u,
    );
    // The IT boards' low floor, never the shared one's (`_LOW` is a word character: no match).
    expect(source).not.toMatch(/\bBOARD_TABLE_FILL\b/u);
    expect(divsNaming(source, 'BOARD_FRAME').length).toBeGreaterThan(0);
  });

  it.each(BOARDS)('%s: the table fills the frame, under a head that stays', (page) => {
    const source = code(page);
    const frames = divsNaming(source, 'BOARD_FRAME');
    const fills = [...source.matchAll(/<div className=\{BOARD_TABLE_FILL_LOW\}>/gu)];
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      const range = divAt(source, fill.index)!;
      const inner = source.slice(fill.index + fill[0].length, range.end - '</div>'.length).trim();
      // The DataTable is the wrapper's DIRECT child — or a tab's choice between DataTables is.
      expect(inner, page).toMatch(/^(?:<DataTable\b|\{)/u);
      const tables = inner.match(/<DataTable\b/gu)?.length ?? 0;
      expect(tables, page).toBeGreaterThan(0);
      expect(inner.match(/\bstickyHead\b/gu)?.length ?? 0, page).toBe(tables);
      // Inside the board's frame, which hands it the height that is left.
      expect(
        frames.some((frame) => frame.start < fill.index && range.end <= frame.end),
        `${page}: the table's wrapper sits in a BOARD_FRAME`,
      ).toBe(true);
    }
  });

  it.each(BOARDS)('%s: the pager keeps its place below the rows', (page) => {
    const source = code(page);
    const frames = divsNaming(source, 'BOARD_FRAME');
    const fills = [...source.matchAll(/<div className=\{BOARD_TABLE_FILL_LOW\}>/gu)].map((fill) =>
      divAt(source, fill.index)!,
    );
    const pagers = [...source.matchAll(PAGER)].map((m) => m.index);
    expect(pagers.length, page).toBeGreaterThan(0);
    for (const at of pagers) {
      // After the table's wrapper has CLOSED — not inside the scroll — and in the same frame.
      expect(
        frames.some(
          (frame) =>
            frame.start < at &&
            at < frame.end &&
            fills.some((fill) => frame.start < fill.start && fill.end <= at),
        ),
        `${page}: a pager at ${at} follows the table's wrapper inside the frame`,
      ).toBe(true);
    }
  });

  it('the IT boards’ fill is the shared one with a lower floor — and nothing else', () => {
    // Fleet's and ATM's boards keep the shared 14rem; only the IT boards' rows give way sooner.
    const FLOOR = /^lg:min-h-\[(\d+(?:\.\d+)?)rem\]$/u;
    const classes = (value: string): string[] => value.split(/\s+/u).filter(Boolean);
    const low = classes(BOARD_TABLE_FILL_LOW);
    const shared = classes(BOARD_TABLE_FILL);
    expect(low.filter((c) => !FLOOR.test(c))).toEqual(shared.filter((c) => !FLOOR.test(c)));
    expect(low.filter((c) => FLOOR.test(c))).toEqual(['lg:min-h-[8rem]']);
    expect(shared.filter((c) => FLOOR.test(c))).toEqual(['lg:min-h-[14rem]']);
  });

  it('the bulk upload: the lines scroll in a box of their own, under a head that stays', () => {
    const preview = code(IMPORT_PREVIEW);
    const box = /<div className=\{(\w+)\}>\s*<DataTable\b/u.exec(preview);
    expect(box, 'the lines’ DataTable is the direct child of a named box').not.toBeNull();
    const name = box![1]!;
    // The box caps the DataTable's own scroll wrapper on a computer.
    expect(preview).toMatch(
      new RegExp(`const ${name} = '[^']*\\blg:\\[&>div\\]:max-h-\\[[^\\]]+\\][^']*';`, 'u'),
    );
    const table = preview.slice(box!.index, divAt(preview, box!.index)!.end);
    expect(table).toMatch(/\bstickyHead\b/u);
    // The page itself still grows down the screen: the steps, the counts and the kinds above the
    // lines already take more than a screen, so a full-height frame would leave the lines nothing.
    expect(code(IMPORT_PAGE)).not.toContain('fullHeight');
  });

  it.each(NOT_BOARDS)('%s is not squeezed into one screen', (page) => {
    expect(code(page)).not.toContain('fullHeight');
  });

  it('every IT page is one or the other — a new screen has to say which', () => {
    const pages = readdirSync(HERE).filter(
      (file) => file.endsWith('.tsx') && !file.endsWith('.spec.tsx'),
    );
    expect([...pages].sort()).toEqual([...BOARDS, IMPORT_PAGE, ...NOT_BOARDS].sort());
  });
});
