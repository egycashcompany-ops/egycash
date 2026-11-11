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
