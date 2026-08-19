// The day board's filter bar. Eight controls in a stacked-label grid took TWO rows, which pushed
// the table itself below the fold on a laptop — the one thing the screen exists to show.
//
// The row is now the shape the vehicle registry settled on: a FilterBar (`flex flex-wrap`) with
// each control sized by a wrapper. What that costs is the visible label above each box, and the
// risk that comes with it is losing the control's NAME rather than just its pixels. These cases
// hold that line: a filter with no visible label and no `aria-label` is a box nobody can identify,
// by eye or by screen reader.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(
  fileURLToPath(new URL('./DailyOperationsPage.tsx', import.meta.url)),
  'utf8',
);

/** The filter bar's own markup, from `<FilterBar` to its close — not the rest of the page. */
const BAR = PAGE.slice(PAGE.indexOf('<FilterBar'), PAGE.indexOf('</FilterBar>'));

describe('the eight filters sit on one row', () => {
  it('uses the shared FilterBar, not a two-row grid', () => {
    expect(PAGE).toContain('<FilterBar');
    // The grid that produced the second row: four columns and eight controls.
    expect(PAGE).not.toContain('lg:grid-cols-4');
  });

  it('carries no stacked label above a control', () => {
    expect(BAR).not.toContain('mb-1 block');
  });

  it('sizes each text filter with a wrapper, since the control base class is w-full', () => {
    // `cn` has no tailwind-merge, so a width passed to the Input loses to its own `w-full` and
    // every box would stretch the bar — one filter per line, which is the bug being fixed.
    expect(BAR).toMatch(/<div className="w-\d+">\s*<Input/);
  });
});

describe('nothing lost its name when the labels went', () => {
  const FILTERS = [
    'operations.dailyOps.date',
    'operations.shipment.mainBank',
    'operations.shipment.origin',
    'operations.shipment.destination',
    'operations.shipment.area',
    'operations.shipment.notes',
    'operations.shipment.type',
    'operations.dailyOps.received',
  ];

  it('names all eight controls to a screen reader', () => {
    for (const key of FILTERS) {
      expect(BAR, key).toContain(`aria-label={t('${key}')}`);
    }
  });

  it('names all eight on screen too — as a placeholder, or the select’s own empty option', () => {
    for (const key of FILTERS) {
      const shown =
        BAR.includes(`placeholder={t('${key}')}`) ||
        BAR.includes(`<option value="">{t('${key}')}</option>`) ||
        // A date input renders its own format hint and ignores `placeholder`; `title` is what
        // survives the hover.
        BAR.includes(`title={t('${key}')}`);
      expect(shown, key).toBe(true);
    }
  });
});

describe('clearing returns the whole view to its default', () => {
  it('offers the reset once anything narrows the board — filters OR a day that is not today', () => {
    // `hasActiveFilter` was exported by `lib/day-board.ts` from the start and never wired to
    // anything; the bar is what finally uses it.
    expect(BAR).toContain('hasActiveFilters={hasActiveFilter(filters) || date !== null}');
  });

  it('clears the day as well, so nothing is left narrowed after a reset', () => {
    expect(BAR).toContain('EMPTY_DAY_BOARD_FILTERS');
    expect(BAR).toContain("next.delete('date')");
  });
});
