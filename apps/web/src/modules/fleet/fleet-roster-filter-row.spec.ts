// «فى مشكلة باقى الفلاتر مش ظاهرة» → «لا صغر شوية كود السيارة وخلى كله صف واحد».
//
// On the computer's «تعيين السيارات» the dark filter bar is ONE row: «كود السيارة», then one chip
// per counter and per mission (DeskCounters), then the red reset. With production's twelve missions
// the eighteen chips needed 1599.4px and the row gave them 1478 — at 1920px, the nav unpinned, the
// reset showing: 121.4px short, and the last chip «نقل أموال (يومي)» sat past the row's hidden
// scrollbar, out of a mouse's reach. The owner kept the one row (no second line) and chose a
// smaller «كود السيارة»: 15rem → 12rem, with the chips a little tighter — 4px apart (was 6), 8px of
// padding a side (was 10), 4px between word and figure (was 6); the same 36px height, type, tones
// and ring. Measured after on the real page, on that day's figures: 68.6px to spare with the
// reset, about 110 without. The spare is that day's: each extra digit in a chip's figure costs
// about 9px, and a day with every mission in two digits is 41px short again at 1920 with the reset.
// The shots are the proof of the pixels; these claims pin the classes behind them.
//
// Narrower screens (a laptop, a pinned nav), and such a day at 1920, still cannot hold eighteen
// chips. There the owner chose «أ اعمل الأسهم ولما يخضر اعمل ميرج» — option أ: a small ‹ › at
// each end of the row moves the chips, and the row stays ONE line. The arrows show only while the
// chips overflow, OUTSIDE the scroller, the spent one dimmed and disabled; their arithmetic is
// `lib/row-scroll.ts` (its own spec). The touch boards are not part of it — their row scrolls
// under a finger.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../../platform/localization/i18n';
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
/** The hook that measures the row for the arrows. */
const ROW_ENDS = declaration(DESK, 'const useRowEnds');
/** The arrows' own look. */
const ARROW = /const ROW_ARROW =\s*'([^']*)'/u.exec(DESK)?.[1] ?? '';
/** One arrow button, by its end: from its `<button` to its `</button>`. */
const arrow = (end: 'start' | 'end'): string => {
  const at = COUNTERS.indexOf(`data-counters-arrow="${end}"`);
  if (at === -1) throw new Error(`no ${end} arrow`);
  const open = COUNTERS.lastIndexOf('<button', at);
  return COUNTERS.slice(open, COUNTERS.indexOf('</button>', at) + '</button>'.length);
};
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
    // padding and inner gap. Eighteen chips: six counters, twelve missions. The figures are the
    // measured day's; every extra digit in a chip takes about 9px of the spare back.
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

  it('puts a ‹ › at each end only while the chips overflow — «أ اعمل الأسهم»', () => {
    // Both arrows hang on the one measured flag: none when everything fits (the bar exactly as it
    // was), both while it overflows — the spent one disabled, not removed, so nothing shifts.
    expect(
      COUNTERS.match(/\{ends\.overflowing && \(/gu),
      'each arrow behind the overflow',
    ).toHaveLength(2);
    expect(arrow('start'), 'spent at the start').toContain('disabled={ends.atStart}');
    expect(arrow('end'), 'spent at the end').toContain('disabled={ends.atEnd}');
    expect(arrow('start')).toContain("onClick={() => step('start')}");
    expect(arrow('end')).toContain("onClick={() => step('end')}");
    for (const end of ['start', 'end'] as const)
      expect(arrow(end), 'a real button').toMatch(/^<button\s+type="button"/u);
  });

  it('stands the arrows OUTSIDE the scroller, so they never cover a chip', () => {
    // [start arrow][the row][end arrow], siblings in a frame that takes the row's old place on
    // the bar (one line, no scroll of its own). In RTL the start is the right, beside «كود
    // السيارة»; the end the left, beside the reset.
    const start = COUNTERS.indexOf('data-counters-arrow="start"');
    const row = COUNTERS.indexOf('data-counters="true"');
    const chips = COUNTERS.indexOf('{counters.map(', row);
    const rowClose = COUNTERS.indexOf('</div>', COUNTERS.indexOf('))}', chips));
    const end = COUNTERS.indexOf('data-counters-arrow="end"');
    expect(start).toBeGreaterThan(-1);
    expect(start, 'start arrow before the row').toBeLessThan(row);
    expect(rowClose, 'the row closes before the end arrow').toBeLessThan(end);
    expect(COUNTERS.slice(row, rowClose), 'no arrow inside the scroller').not.toContain(
      'data-counters-arrow',
    );
    expect(COUNTERS).toContain(
      '<div ref={frame} data-counters-frame="true" className="flex min-w-0 flex-1 items-center gap-1">',
    );
  });

  it('names each arrow in formal Arabic and English, through i18n', () => {
    expect(arrow('start')).toContain("aria-label={t('fleet.roster.filtersPrev')}");
    expect(arrow('start')).toContain("title={t('fleet.roster.filtersPrev')}");
    expect(arrow('end')).toContain("aria-label={t('fleet.roster.filtersNext')}");
    expect(arrow('end')).toContain("title={t('fleet.roster.filtersNext')}");
    expect(translate('ar', 'fleet.roster.filtersPrev')).toBe('عرض الفلاتر السابقة');
    expect(translate('ar', 'fleet.roster.filtersNext')).toBe('عرض الفلاتر التالية');
    expect(translate('en', 'fleet.roster.filtersPrev')).toBe('Show previous filters');
    expect(translate('en', 'fleet.roster.filtersNext')).toBe('Show more filters');
  });

  it('points each chevron its way, flipped under RTL as the day stepper’s are', () => {
    expect(arrow('start')).toContain('<ChevronStartIcon className="h-4 w-4 rtl:-scale-x-100" />');
    expect(arrow('end')).toContain('<ChevronEndIcon className="h-4 w-4 rtl:-scale-x-100" />');
    // The look: the chips' 36px, narrow, the stepper's tones, the chips' focus ring, dimmed spent.
    for (const piece of [
      'h-9',
      'w-8',
      'rounded-lg',
      'border-slate-300',
      'dark:border-slate-700',
      'bg-white',
      'dark:bg-[#111827]',
      'enabled:hover:bg-slate-100',
      'dark:enabled:hover:bg-slate-800',
      'focus-visible:ring-2',
      'focus-visible:ring-offset-1',
      'disabled:opacity-40',
    ])
      expect(ARROW.split(/\s+/u), piece).toContain(piece);
  });

  it('moves the row with the tested arithmetic: the direction read, less motion honoured', () => {
    expect(COUNTERS).toContain("getComputedStyle(box).direction === 'rtl' ? 'rtl' : 'ltr'");
    expect(COUNTERS).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(COUNTERS).toContain(
      'box.scrollBy(rowStep(toward, direction, box.clientWidth, reduced));',
    );
    // No other behaviour: no wheel taken over, no chip scrolled to on its own.
    expect(COUNTERS).not.toMatch(/onWheel|'wheel'|scrollIntoView/u);
  });

  it('measures on resize, on scroll and on new counters — and lets go on unmount', () => {
    // The room WITHOUT the arrows decides whether they show (rowEnds), so they never keep
    // themselves on screen.
    expect(ROW_ENDS).toContain('const next = rowEnds(box, room.clientWidth);');
    expect(ROW_ENDS).toContain('new ResizeObserver(measure)');
    expect(ROW_ENDS).toContain('observer?.observe(room);');
    expect(ROW_ENDS).toContain('observer?.observe(box);');
    expect(ROW_ENDS, 'each chip, for its figure and its font').toContain(
      'for (const chip of Array.from(box.children)) observer?.observe(chip);',
    );
    expect(ROW_ENDS).toContain("box.addEventListener('scroll', measure, { passive: true });");
    expect(ROW_ENDS).toContain("box.removeEventListener('scroll', measure);");
    expect(ROW_ENDS).toContain('observer?.disconnect();');
    expect(ROW_ENDS, 'again when the counters change').toContain('}, [shape]);');
    expect(ROW_ENDS, 'no polling').not.toMatch(/setInterval|setTimeout|requestAnimationFrame/u);
    expect(COUNTERS).toContain('const [frame, row, ends] = useRowEnds(shape);');
  });

  it('leaves the touch boards’ row and chips as they were', () => {
    // Under a finger the row swipes; nothing of this change reaches it.
    expect(TOUCH, 'no arrows under a finger').not.toMatch(
      /data-counters-arrow|filtersPrev|filtersNext|rowStep|useRowEnds/u,
    );
    expect(TOUCH).toContain(
      'className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scroll-px-1 px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"',
    );
    expect(TOUCH).toContain(
      "'flex h-12 min-w-[3.75rem] shrink-0 flex-col items-center justify-center rounded-lg px-2.5 font-medium transition-shadow'",
    );
  });
});
