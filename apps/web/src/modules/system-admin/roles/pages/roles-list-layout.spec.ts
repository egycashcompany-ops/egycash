// «بدل ما الإدارات تتحت بعض وتحت كل واحده الأدوار لأ عايز الإدارات تبقي جنب بعض» (2026-11-22).
//
// The roles page shows its departments SIDE BY SIDE: one card per department, in columns that
// wrap onto the next row. The owner was shown two samples and chose this one over a board of
// columns that scrolls sideways, because the board hides every department past the fourth. The
// suite has no DOM to measure a layout in, so this holds the page to the shape the layout needs,
// and models the column count from the grid's own numbers; the model was checked against the
// browser, whose list widths are the ones in the table below (Chromium, 390 to 2560 px, both
// navigation layouts with their panel pinned and not, with and without a 15 px scrollbar).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'RolesListPage.tsx'),
  'utf8',
);

const declared = (name: string): string => {
  const match = new RegExp(`const ${name} =\\s*'([^']+)'`).exec(PAGE);
  return match?.[1] ?? '';
};

const GRID = declared('DEPARTMENT_GRID').split(/\s+/);
const NAME_WRAP = declared('NAME_WRAP').split(/\s+/);

/** The one `grid-cols-[repeat(auto-fill,…)]` class, read for its card width, its cap and its gaps. */
const TRACK =
  /^grid-cols-\[repeat\(auto-fill,minmax\(min\(100%,max\((\d+(?:\.\d+)?)rem,calc\(\(100%_-_(\d+(?:\.\d+)?)rem\)\/(\d+)\)\)\),1fr\)\)\]$/;
const track = (): { minRem: number; gapsRem: number; cap: number } => {
  const match = GRID.map((c) => TRACK.exec(c)).find((m) => m !== null);
  if (match === undefined || match === null)
    throw new Error('DEPARTMENT_GRID has no auto-fill track');
  return { minRem: Number(match[1]), gapsRem: Number(match[2]), cap: Number(match[3]) };
};

/** `gap-N` in rem (Tailwind: N × 0.25rem). */
const gapRem = (): number =>
  Number(/^gap-(\d+)$/.exec(GRID.find((c) => /^gap-\d+$/.test(c)) ?? '')?.[1]) / 4;

/**
 * How many columns CSS lays for a list `width` px wide: `auto-fill` fits as many tracks as their
 * minimum allows, the minimum being `min(100%, max(minRem, (100% − gaps) / cap))`.
 */
const columns = (width: number): number => {
  const { minRem, gapsRem, cap } = track();
  const gap = gapRem() * 16;
  const minimum = Math.min(width, Math.max(minRem * 16, (width - gapsRem * 16) / cap));
  return Math.max(1, Math.floor((width + gap) / (minimum + gap)));
};

describe('the roles page lays its departments side by side', () => {
  it('puts the department cards in a grid of columns that wraps, and nothing else', () => {
    // Pinned whole: a `grid-flow-col`, an `auto-cols-*` or a `flex` here would make a sideways
    // board out of the same cards, with no `overflow-x` class needed — the board frame's
    // `overflow-y-auto` already lets a too-wide list scroll sideways.
    expect(GRID).toEqual([
      'grid',
      expect.stringMatching(TRACK),
      // Each card is the height of its own roles, not of the tallest card in its row.
      'items-start',
      'gap-4',
    ]);
  });

  it('counts its columns as the owner saw them, from the room the list really has', () => {
    const { gapsRem, cap } = track();
    // The cap's arithmetic matches the gap it subtracts: four cards have three gaps.
    expect(gapsRem).toBe((cap - 1) * gapRem());
    expect(cap).toBe(4);
    // The list's width (px) in the browser → the columns CSS lays.
    const SEEN: [string, number, number][] = [
      ['a phone, 390', 358, 1],
      ['a small tablet, 640', 592, 1],
      ['a tablet, 768', 720, 2],
      ['a laptop, 1024', 904, 2],
      ['1280', 1160, 3],
      ['1440', 1320, 3],
      ['1536', 1416, 4],
      ['2560: still four, wider', 2440, 4],
      ['1024, the launchpad panel pinned', 720, 2],
      ['1280, the launchpad panel pinned', 976, 2],
      ['1536, the launchpad panel pinned: three, not four cramped ones', 1232, 3],
      ['1920, the launchpad panel pinned', 1616, 4],
      ['1024, the rail and its panel pinned', 680, 2],
      ['1366, the rail and its panel pinned', 1022, 3],
      ['1536, the rail and its panel pinned', 1192, 3],
      // A scrollbar that takes 15 px of the list never costs a column.
      ['1024 rail pinned, with a scrollbar', 665, 2],
      ['1366 rail pinned, with a scrollbar', 1007, 3],
      ['1440, with a scrollbar', 1305, 3],
      ['1536, with a scrollbar', 1401, 4],
    ];
    for (const [where, width, expected] of SEEN) {
      expect({ where, columns: columns(width) }).toEqual({ where, columns: expected });
    }
  });

  it('draws every department card inside that grid', () => {
    expect(PAGE).toMatch(
      /<div className=\{DEPARTMENT_GRID\}>\s*\{groups\.map\(\(group\) => \(\s*<Card\b/,
    );
  });

  it('writes a role or a department name in full, wrapped and never cut', () => {
    // A word too long for its card breaks inside itself rather than running under the chips, or
    // widening the card past a phone's screen.
    expect(NAME_WRAP).toEqual(expect.arrayContaining(['min-w-0', '[overflow-wrap:anywhere]']));
    const CLIPS = /^(truncate|line-clamp-\d+|whitespace-nowrap|text-ellipsis|overflow-hidden)$/;
    expect(NAME_WRAP.filter((c) => CLIPS.test(c))).toEqual([]);

    const heading =
      /<h3\s+className=\{cn\(\s*NAME_WRAP,\s*'([^']*)',?\s*\)\}\s*>\s*\{group\.name\}/.exec(PAGE);
    const name =
      /className=\{cn\(\s*NAME_WRAP,\s*'([^']*)',?\s*\)\}\s*>\s*\{role\.name\[locale\]\}/.exec(
        PAGE,
      );
    expect(heading).not.toBeNull();
    expect(name).not.toBeNull();
    for (const extra of [heading?.[1] ?? '', name?.[1] ?? '']) {
      expect(extra.split(/\s+/).filter((c) => CLIPS.test(c))).toEqual([]);
    }
    // The role's name takes the row's room; its chips keep theirs.
    expect((name?.[1] ?? '').split(/\s+/)).toContain('flex-1');
    expect(PAGE).toMatch(/<ManagedRoleBadge managed=\{role\.managed\} className="shrink-0" \/>/);
    expect(PAGE).toMatch(/<Badge size="sm" tone="neutral" className="shrink-0">/);
  });
});
