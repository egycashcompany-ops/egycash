// «there is a gap when u scroll down on daily attendance» (the owner, 23 November).
//
// WHAT THE GAP WAS. `main` is a flex column and the shell stretches the page's wrapper to fill it,
// but the page itself was `shrink-0` — so on a screen taller than the sheet (a big monitor, a
// zoomed-out window, or simply a quiet day with few rows) the wrapper filled the screen, the card
// stopped at its own content, and the difference showed as dead space under it. Measured at
// 2560×1440 with four rows: 380px of nothing below the card.
//
// WHY `fill` AND NOT `fullHeight`. `fullHeight` CAPS the page at the screen and hands the scrolling
// to a region inside it — right for a board read across, wrong here: on a laptop the hero, the
// title bar and the status segments would leave the rows a sliver. `fill` sets `flex-1` and leaves
// `min-height` at `auto`, so the page grows into spare room and never shrinks below its own
// content. A day that already overflows the screen scrolls exactly as it did before.
//
// Read from the source with the comments stripped, as the IT and system-admin board specs read
// theirs: a frame named only in prose must not keep this green.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (rel: string): string =>
  readFileSync(join(HERE, rel), 'utf8')
    .replace(/^\s*\/\/.*$/gmu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '');

const PAGE_CONTAINER = join(HERE, '..', '..', '..', 'platform', 'layout', 'PageContainer.tsx');
const container = readFileSync(PAGE_CONTAINER, 'utf8')
  .replace(/^\s*\/\/.*$/gmu, '')
  .replace(/\/\*[\s\S]*?\*\//gu, '');

describe('the daily sheet reaches the bottom of the screen', () => {
  it('the page fills rather than caps — it must still scroll on a day that overflows', () => {
    const source = code('pages/DailySheetPage.tsx');
    expect(source).toContain('<PageContainer fill>');
    // `fullHeight` would squeeze the rows under the hero on a laptop. Not this screen.
    expect(source).not.toContain('fullHeight');
  });

  it('`fill` grows into spare room and never below its content — no `min-h-0`', () => {
    // The whole fix rests on `min-height` staying at `auto`: a flex item with `min-h-0` may be
    // shrunk below its content, which is what `fullHeight` wants and what this must never do.
    const fill = /fill && !fullHeight && '([^']+)'/u.exec(container);
    expect(fill, 'PageContainer declares a `fill` mode').not.toBeNull();
    const classes = (fill?.[1] ?? '').split(/\s+/u).filter(Boolean);
    expect(classes).toContain('flex-1');
    expect(classes).toContain('flex');
    expect(classes).toContain('flex-col');
    expect(classes).not.toContain('min-h-0');
    // And the default is untouched, so every other screen is exactly as it was.
    expect(container).toContain("!fullHeight && !fill && 'shrink-0'");
  });

  it('the canvas and the card pass the spare height down to the rows', () => {
    const source = code('views/DailySheetView.tsx');
    // A container that grows while its children do not just moves the gap inside the card.
    expect(source).toContain('<AttendanceCanvas fill>');
    expect(source).toMatch(/<Sheet className="[^"]*\bflex-1\b[^"]*">/u);
    expect(source).toMatch(/<Sheet className="[^"]*\bflex-col\b[^"]*">/u);
    // The table's own wrapper is where the room lands — under the rows, inside the card.
    expect(source).toMatch(/<div className="flex-1 overflow-x-auto[^"]*">/u);
  });

  it('the canvas only takes the give when asked', () => {
    const parts = code('views/view-parts.tsx');
    expect(parts).toMatch(/fill && 'flex flex-1 flex-col'/u);
    // The employee month and the working-hours panel are read DOWN and end where they end.
    expect(code('views/EmployeeAttendanceView.tsx')).toContain('<AttendanceCanvas>');
    expect(code('pages/WorkingHoursPage.tsx')).toContain('<AttendanceCanvas>');
    for (const page of ['views/EmployeeAttendanceView.tsx', 'pages/WorkingHoursPage.tsx']) {
      expect(code(page), page).not.toContain('<AttendanceCanvas fill>');
    }
  });
});
