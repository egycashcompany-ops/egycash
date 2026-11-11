// «فى مشكلة باقى الفلاتر مش ظاهرة» → «لا صغر شوية كود السيارة وخلى كله صف واحد».
//
// On the computer's «تعيين السيارات» the dark filter bar is ONE row: «كود السيارة», then one chip
// per counter and per mission (DeskCounters), then the red reset. With production's twelve missions
// the eighteen chips needed 1599.4px and the row gave them 1478 — at 1920px, the nav unpinned, the
// reset showing: 121.4px short, and the last chip «نقل أموال (يومي)» sat past the row's hidden
// scrollbar, out of a mouse's reach. The owner kept the one row (no second line) and chose a
// smaller «كود السيارة»: 15rem → 12rem, with the chips a little tighter — 4px apart (was 6), 8px of
// padding a side (was 10), 4px between word and figure (was 6); the same 36px height, type, tones
// and ring. Measured after on the real page: 68.6px to spare with the reset, about 110 without.
// The shots are the proof of the pixels; these claims pin the classes behind them.
//
// Narrower screens (a laptop, a pinned nav) still cannot hold eighteen chips; what the row does
// there is unchanged here. The touch boards are not part of it — their row scrolls under a finger.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rosterSource } from './roster-spec-sources';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The computer's board, as code (comments stripped). */
const DESK = rosterSource(['desk']);
/** The phone and tablet board, as code. */
const TOUCH = rosterSource(['touch']);

/** From `marker` to the next top-level declaration — one component of a file. */
const declaration = (source: string, marker: string): string => {
  const at = source.indexOf(marker);
  if (at === -1) throw new Error(`no ${marker}`);
  const next = source.slice(at + marker.length).search(/\n(?:export )?const /u);
  return next === -1 ? source.slice(at) : source.slice(at, at + marker.length + next);
};

/** The value of one Tailwind spacing class in a class list, in px (`gap-1` → 4, `w-48` → 192). */
const px = (classes: string, utility: string): number => {
  const found = new RegExp(`(?:^|\\s)${utility}-(\\d+(?:\\.\\d+)?)(?=\\s|$)`, 'u').exec(classes);
  if (found === null) throw new Error(`no ${utility}-… in «${classes}»`);
  return Number(found[1]) * 4;
};

const COUNTERS = declaration(DESK, 'export const DeskCounters');
/** The row the chips stand in. */
const ROW = /data-counters="true"\s+className="([^"]*)"/u.exec(COUNTERS)?.[1] ?? '';
/** One chip, before its tone and its ring. */
const CHIP = /'(inline-flex h-9 [^']*)'/u.exec(COUNTERS)?.[1] ?? '';
/** «كود السيارة»'s frame on the bar. */
const CAR =
  /<FilterWithIcon\s+icon=\{FILTER_ICON\.car\}[^>]*?className="([^"]*)"/u.exec(DESK)?.[1] ?? '';

describe('«تعيين السيارات» on a computer: every filter on ONE row', () => {
  it('gives «كود السيارة» 12rem — and holds it against the bar’s shared width', () => {
    // The dark bar shares its width out (`lg:[&>div>*]:!flex-1`); the `lg:[&&]:` pair keeps this
    // box at its own width there. At 12rem the placeholder, the icon and one code or three
    // («215, 216, 217») are still whole (measured).
    expect(CAR).toBe('w-48 shrink-0 lg:[&&]:!w-48 lg:[&&]:!flex-none');
    expect(px(CAR, 'w'), '12rem').toBe(192);
    expect(DESK, 'the 15rem box is gone').not.toContain('lg:[&&]:!w-60');
  });

  it('keeps the counters on one line, 4px apart, with room for the active ring', () => {
    // ONE line: no wrap. `px-1 py-1` stay — the active chip's ring sits 3px outside it, and the
    // row would clip it at either end without them. The hidden sideways scroll is as it was.
    expect(ROW).toBe(
      'flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
    );
    expect(ROW.split(/\s+/u), 'one line').not.toContain('flex-wrap');
    expect(px(ROW, 'gap'), 'the chips 4px apart').toBe(4);
    // …and the bar around it stays one row on a computer, the reset at its own size.
    const BAR = readFileSync(join(HERE, '../../shared/ui/dark-filter-bar.ts'), 'utf8');
    expect(BAR).toContain('lg:[&>div]:!flex-nowrap');
    expect(BAR).toContain('lg:[&>div>.ms-auto]:!flex-none');
  });

  it('tightens each chip and nothing else — the same height, type, tones and ring', () => {
    expect(CHIP).toBe(
      'inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-xs font-medium transition-shadow',
    );
    expect(px(CHIP, 'px'), '8px a side').toBe(8);
    expect(px(CHIP, 'gap'), '4px between word and figure').toBe(4);
    expect(COUNTERS, 'the figure as it was').toContain(
      '<span className="font-figures text-sm font-bold">{num(counter.value)}</span>',
    );
    expect(COUNTERS, 'the tone as it was').toContain('counter.tone,');
    expect(COUNTERS, 'the ring as it was').toContain(
      "'ring-2 ring-offset-1 ring-offset-white dark:ring-offset-[#111827]'",
    );
  });

  it('adds up: the 121.4px the chips were short, and what the change gives back', () => {
    // Measured before, at 1920 with the reset: 1599.4px of chips in a 1478px row. The row gains
    // what «كود السيارة» gives up; the chips need less by the gaps between them and by each chip's
    // padding and inner gap. Eighteen chips: six counters, twelve missions.
    const chips = 18;
    const before = { car: 240, gap: 6, pad: 10, inner: 6 };
    const after = {
      car: px(CAR, 'w'),
      gap: px(ROW, 'gap'),
      pad: px(CHIP, 'px'),
      inner: px(CHIP, 'gap'),
    };
    const given = before.car - after.car;
    const saved =
      (chips - 1) * (before.gap - after.gap) +
      chips * (2 * (before.pad - after.pad) + (before.inner - after.inner));
    expect(given + saved - 121.4, 'px to spare at 1920 with the reset').toBeCloseTo(68.6, 1);
  });

  it('leaves the touch boards’ row and chips as they were', () => {
    // Under a finger the row swipes; nothing of this change reaches it.
    expect(TOUCH).toContain(
      'className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scroll-px-1 px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"',
    );
    expect(TOUCH).toContain(
      "'flex h-12 min-w-[3.75rem] shrink-0 flex-col items-center justify-center rounded-lg px-2.5 font-medium transition-shadow'",
    );
  });
});
