// «توزيع المحصنات» and «تسليم المحصنات» — how the page's top row lays itself out (Round 26b), as a
// pure rule over the widths the browser measures.
//
// THE OWNER: «عاوز اخلى التاريخ يكون مكان الاحصائيات والاحصائيات تكون فى النص» — the day («يوم
// التسليم») at the start, the figures in the MIDDLE, the acts («توزيع تلقائي», «تراجع», «حفظ») at the
// end.
//
// R26b critic — the row switched to one line at a fixed width (68rem) with the two sides at least
// their own content: between that width and the one the three parts really
// need, the figures were pushed off the middle (29px at 1225 in Arabic) or split onto two lines
// inside the row, and to hold them near it the acts dropped their words over a far wider range than
// meant («Auto-distribute» a bare arrow from 1208 to 1431 in English). The row now MEASURES its
// parts — whatever the language, the counts (three figures, «حفظ (12)»), a scrollbar or the zoom —
// and takes one line only where the figures can stand exactly in its middle with every act's words:
//   · `line` — one line, two sides of EQUAL width (each as wide as the wider of the day and the acts),
//     the figures between them: truly in the middle;
//   · `beside` — no acts (the vault's screen, a reader who may not edit): the day, then the figures
//     centred in the rest of the line, where they do not fit truly in the middle but fit beside it;
//   · `split` — the day and the acts on the first line, the figures centred on a line of their own;
//   · `stack` — a phone: the day, the figures, the acts, each a line, centred.

export type TopRowLayout = 'line' | 'beside' | 'split' | 'stack';

/** Below this width (36rem) the row is a phone's: everything stacks. */
export const TOP_ROW_PHONE = 576;

/**
 * Entering `line` (or `beside`) asks this much room to spare, staying in it none: a row exactly at
 * the edge never flips back and forth (a scrollbar coming and going with the row's height, a
 * rounding).
 */
export const TOP_ROW_SLACK = 8;

/** The widths measured (px): the row, each part at its natural width, the gap between columns. */
export interface TopRowWidths {
  row: number;
  day: number;
  figures: number;
  /** The acts; null when the row has none. */
  end: number | null;
  gap: number;
}

/** The width one line needs: the figures, and two equal sides as wide as the wider of day and acts. */
export const topRowLineNeeds = ({ day, figures, end, gap }: Omit<TopRowWidths, 'row'>): number =>
  figures + 2 * Math.max(day, end ?? 0) + 2 * gap;

/** Which layout the row takes (`was` — the one it has now, for the slack). */
export const topRowLayout = (widths: TopRowWidths, was?: TopRowLayout): TopRowLayout => {
  const { row, day, figures, end, gap } = widths;
  if (row < TOP_ROW_PHONE) return 'stack';
  if (end !== null && row < day + gap + end) return 'stack';
  const slack = (layout: TopRowLayout): number => (was === layout ? 0 : TOP_ROW_SLACK);
  if (row >= topRowLineNeeds(widths) + slack('line')) return 'line';
  if (end === null && row >= day + gap + figures + slack('beside')) return 'beside';
  return 'split';
};
