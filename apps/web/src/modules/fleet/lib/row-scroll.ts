// «تعيين السيارات» on a computer — the filter row's ‹ › arrows, as arithmetic. «فى مشكلة باقى
// الفلاتر مش ظاهرة» → «لا صغر شوية كود السيارة وخلى كله صف واحد» → «أ اعمل الأسهم»: the row stays
// ONE line with its scrollbar hidden, and where its chips do not fit an arrow at each end moves
// them. Kept here, pure, so what the arrows read and do is what a node test reads.
//
// Sideways scroll in a right-to-left row, as Chromium (and the CSSOM spec) report it: `scrollLeft`
// is 0 at the row's START and runs NEGATIVE toward its end; in a left-to-right row it is 0 at the
// start and positive toward the end. Its magnitude is the distance from the start either way, and
// a zoomed screen can leave it a fraction of a pixel off either end — hence the 1px tolerances.

/** What the row's own box reports: its sideways offset and its two widths. */
export interface RowScrollBox {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/** Whether the arrows show, and which end has been reached. */
export interface RowEnds {
  overflowing: boolean;
  atStart: boolean;
  atEnd: boolean;
}

/** Everything fits: no arrows. */
export const ROW_FITS: RowEnds = { overflowing: false, atStart: true, atEnd: true };

/** One click moves the row by this share of its visible width — the next chips, a few still seen. */
export const ROW_STEP_SHARE = 0.8;

/**
 * Where the row stands. `room` is the width the chips are given WITHOUT the arrows (the row's
 * frame), so the arrows' own 2 × 36px never decide whether they are needed: a row that fits once
 * they are gone loses them, and nothing flickers at the edge.
 */
export const rowEnds = (box: RowScrollBox, room: number = box.clientWidth): RowEnds => {
  const overflowing = box.scrollWidth > room + 1;
  if (!overflowing) return ROW_FITS;
  const offset = Math.abs(box.scrollLeft);
  return {
    overflowing,
    atStart: offset <= 1,
    atEnd: offset + box.clientWidth >= box.scrollWidth - 1,
  };
};

/** Two readings of the row alike — no new render for a scroll that crossed no end. */
export const sameRowEnds = (a: RowEnds, b: RowEnds): boolean =>
  a.overflowing === b.overflowing && a.atStart === b.atStart && a.atEnd === b.atEnd;

/**
 * The `scrollBy` for one click toward the row's `start` or `end`: about 80% of what is visible,
 * signed for the row's direction (toward the end is NEGATIVE `left` in a right-to-left row,
 * positive in a left-to-right one), smooth unless the reader asked for less motion.
 */
export const rowStep = (
  toward: 'start' | 'end',
  direction: 'rtl' | 'ltr',
  clientWidth: number,
  reducedMotion: boolean,
): { left: number; behavior: 'smooth' | 'instant' } => {
  const amount = Math.max(1, Math.round(clientWidth * ROW_STEP_SHARE));
  const towardEnd = toward === 'end' ? 1 : -1;
  return {
    left: (direction === 'rtl' ? -towardEnd : towardEnd) * amount,
    behavior: reducedMotion ? 'instant' : 'smooth',
  };
};

/**
 * The `scrollLeft` of the row's END — as far as it goes: negative in a right-to-left row, positive
 * in a left-to-right one, 0 when nothing is hidden.
 */
export const rowEndOffset = (
  box: Pick<RowScrollBox, 'clientWidth' | 'scrollWidth'>,
  direction: 'rtl' | 'ltr',
): number => {
  const far = Math.max(0, box.scrollWidth - box.clientWidth);
  return direction === 'rtl' ? 0 - far : far;
};

/**
 * Whether a RESIZE puts the row back at its end: it stood there, and the new room leaves it short
 * of it. The end is where the room is taken from — the red reset showing after a chip is clicked
 * takes about 42px off it — while `scrollLeft` keeps its distance from the start, so the chip just
 * clicked at the end would slip out of sight. Only a row that overflowed before and after: one
 * that only now overflows stays at its start. A scroll never asks this — a reader who moves the
 * row away from its end is not put back.
 */
export const holdsEnd = (was: RowEnds, now: RowEnds): boolean =>
  was.overflowing && was.atEnd && now.overflowing && !now.atEnd;

/**
 * Which arrow takes the focus once the focused one is spent: the other, live now. A focused button
 * that turns disabled drops the focus to the page — a keyboard reader who pressed the end arrow
 * until the end would lose their place. Nothing when no arrow is focused or none is spent.
 */
export const focusAfterSpent = (
  ends: RowEnds,
  focused: 'start' | 'end' | null,
): 'start' | 'end' | null => {
  if (!ends.overflowing || ends.atStart === ends.atEnd) return null;
  if (focused === 'end' && ends.atEnd) return 'start';
  if (focused === 'start' && ends.atStart) return 'end';
  return null;
};
