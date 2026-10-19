// The Excel memos' drawing primitives — his sheets as Excel prints them.
//
// 1u = 1 Excel pixel at 100% = 1 CSS px, drawn at the TOP-RIGHT of A4's printable box (Excel's
// «Normal» margins, 0.7in / 0.75in), as Excel prints a right-to-left sheet. Every geometry number
// in the memo renderers is measured off his files; these primitives place cells, borders, free
// lines and the logo the way his sheets do. Ported unchanged from the approved sample.
//
// THE SHEET'S CSS IS SCOPED. A sheet is injected into the app (previews, dialogs, the drawer)
// through `dangerouslySetInnerHTML`, so every selector here starts with `.xm-sheet` — a bare
// `img{…}` would restyle every image of the app while a preview is open. No `@font-face` and no
// `@page` here either: those are written once, into the print document's <head>.
import { EGYCASH_LOGO } from '../../gold/lib/egycash-logo';
import { esc } from './custody-paper-format';
import { STACK, measureText } from './custody-paper-fonts';

/** px with at most two decimals — every coordinate the sheets write. */
const n = (value: number): string => String(Math.round(value * 100) / 100);

export const MEMO_CSS = [
  `.xm-sheet{--f-cal:${STACK.cal};--f-ari:${STACK.ari};--f-ari-b:${STACK.ariB};--f-ari-thin:${STACK.ariThin};--f-ari-cell:${STACK.ariCell};--f-ari-top:${STACK.ariTop};position:relative;box-sizing:border-box;width:210mm;height:297mm;margin:0;background:#fff;color:#000;overflow:hidden;direction:rtl;text-align:right;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
  '.xm-sheet *{box-sizing:border-box;margin:0;padding:0;letter-spacing:0;word-spacing:0;font-style:normal}',
  '.xm-sheet .xm-box{position:absolute;top:.75in;right:.7in;bottom:.75in;left:.7in}',
  '.xm-sheet .xm-paper{position:absolute;top:0;right:0;transform-origin:100% 0}',
  '.xm-sheet .xm-paper>*{position:absolute}',
  '.xm-sheet .xm-paper .xl{background:#000}',
  '.xm-sheet .xm-paper .xc{display:flex;align-items:flex-end;justify-content:center;padding:0 3px 2px;white-space:pre;line-height:1}',
  '.xm-sheet .xm-paper .xc.r{justify-content:flex-start}',
  '.xm-sheet .xm-paper .xc.l{justify-content:flex-end}',
  '.xm-sheet .xm-paper .xc.m{align-items:center;padding-bottom:0}',
  '.xm-sheet .xm-paper .xt{white-space:pre;line-height:1}',
  '.xm-sheet .xm-paper .xg{display:flex;justify-content:space-between}',
  '.xm-sheet .xm-paper .cal{font-family:var(--f-cal)}',
  '.xm-sheet .xm-paper .ari{font-family:var(--f-ari)}',
  '.xm-sheet .xm-paper .ari.b{font-family:var(--f-ari-b)}',
  '.xm-sheet .xm-paper .art{font-family:var(--f-ari-thin)}',
  '.xm-sheet .xm-paper .ark{font-family:var(--f-ari-cell)}',
  '.xm-sheet .xm-paper .arh{font-family:var(--f-ari-top)}',
  '.xm-sheet .xm-paper .b{font-weight:700}',
  '.xm-sheet .xm-paper .n4{font-weight:400}',
  '.xm-sheet .xm-paper .u{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;text-decoration-skip-ink:none}',
  '.xm-sheet .xm-paper bdi{unicode-bidi:isolate;direction:ltr}',
  // The app's reset gives every image `max-width:100%`, the print tab gives it none: neither.
  '.xm-sheet img{display:block;max-width:none}',
].join('\n');

export type Face = 'cal' | 'ari' | 'art' | 'ark' | 'arh';
export interface Look {
  f: Face;
  pt: number;
  b?: boolean;
  u?: boolean;
}
export type Place = { right: number } | { left: number } | { center: number };

export const px = (pt: number): number => (pt * 96) / 72;
const cls = (look: Look): string =>
  `${look.f}${look.b === true ? ' b' : ' n4'}${look.u === true ? ' u' : ''}`;
/** Box top → the top of tall Arabic letters (ا ل), per face, as a share of the font size. */
const INK: Record<Face, number> = { cal: 0.155, ari: 0.23, art: 0.23, ark: 0.23, arh: 0.23 };

/**
 * A cell: `x` is its right edge's distance from the paper's right edge. Bottom-aligned, as Excel
 * (2u over the bottom border); `v: 'm'` centres it. `drop` (u) lowers either — the fuel sheet's
 * figures, which sit 1.5u under the line above as his do, and its header's «المأموريه», whose
 * hamza stands tall. `inner` is HTML: the caller escapes it.
 */
export const cell = (
  x: number,
  y: number,
  w: number,
  h: number,
  inner: string,
  look: Look | null,
  o: { a?: 'c' | 'r' | 'l'; v?: 'b' | 'm'; fill?: string; drop?: number } = {},
): string =>
  `<div class="xc ${o.a ?? 'c'}${o.v === 'm' ? ' m' : ''}${look === null ? '' : ` ${cls(look)}`}" style="right:${n(x)}px;top:${n(y)}px;width:${n(w)}px;height:${n(h)}px${look === null ? '' : `;font-size:${look.pt}pt`}${o.fill === undefined ? '' : `;background:${o.fill}`}${o.drop === undefined ? '' : o.v === 'm' ? `;padding-top:${n(2 * o.drop)}px` : `;padding-bottom:${n(2 - o.drop)}px`}">${inner}</div>`;

export const fill = (x: number, y: number, w: number, h: number, colour: string): string =>
  `<div style="right:${n(x)}px;top:${n(y)}px;width:${n(w)}px;height:${n(h)}px;background:${colour}"></div>`;

/** A thin (1u) horizontal border at y, from x1 to x2 (both from the right). */
export const hl = (y: number, x1: number, x2: number): string =>
  `<div class="xl" style="right:${n(x1 - 0.5)}px;top:${n(y - 0.5)}px;width:${n(x2 - x1 + 1)}px;height:1px"></div>`;
/** A thin vertical border at x (from the right), from y1 to y2. */
export const vl = (x: number, y1: number, y2: number): string =>
  `<div class="xl" style="right:${n(x - 0.5)}px;top:${n(y1 - 0.5)}px;width:1px;height:${n(y2 - y1 + 1)}px"></div>`;
/** Every line of a grid: the rows' boundaries across, the columns' down. */
export const grid = (xs: readonly number[], ys: readonly number[]): string => {
  const x0 = xs[0] ?? 0;
  const x1 = xs.at(-1) ?? 0;
  const y0 = ys[0] ?? 0;
  const y1 = ys.at(-1) ?? 0;
  return [...ys.map((y) => hl(y, x0, x1)), ...xs.map((x) => vl(x, y0, y1))].join('');
};
export const boxAround = (x0: number, x1: number, y0: number, y1: number): string =>
  grid([x0, x1], [y0, y1]);

const where = (p: Place): string =>
  'center' in p
    ? `right:${n(p.center - 450)}px;width:900px;text-align:center`
    : 'right' in p
      ? `right:${n(p.right)}px`
      : `left:${n(p.left)}px`;

/** A free line of text (no cell), placed by the top of its ink, as measured on his paper. */
export const text = (words: string, look: Look, inkTop: number, p: Place): string =>
  `<div class="xt ${cls(look)}" style="top:${n(inkTop - INK[look.f] * px(look.pt))}px;${where(p)};font-size:${look.pt}pt">${esc(words)}</div>`;
/** The same, placed by the middle of its ink (the fuel paper's measures). */
export const textMid = (words: string, look: Look, inkMid: number, p: Place): string =>
  `<div class="xt ${cls(look)}" style="top:${n(inkMid - 0.7 * px(look.pt))}px;${where(p)};font-size:${look.pt}pt">${esc(words)}</div>`;
/**
 * «التوقيع (                )» — the word and its bracket at `right`, the closing bracket at
 * `left` (from the paper's LEFT edge). Written in logical order in a right-to-left line, the
 * brackets mirror exactly as on his paper: «)» beside the word, «(» far to the left.
 */
export const signLine = (
  words: string,
  look: Look,
  top: number,
  right: number,
  left: number,
  mid = false,
): string =>
  `<div class="xt xg ${cls(look)}" style="top:${n(top - (mid ? 0.7 : INK[look.f]) * px(look.pt))}px;right:${n(right)}px;left:${n(left)}px;font-size:${look.pt}pt"><span>${esc(words)}</span><span>)</span></div>`;

export const logo = (right: number, top: number, w: number, h: number | null): string =>
  `<img src="${EGYCASH_LOGO}" alt="" style="right:${n(right)}px;top:${n(top)}px;width:${n(w)}px;${h === null ? 'height:auto' : `height:${n(h)}px;object-fit:fill`}" />`;

/** A figure, isolated left-to-right inside the right-to-left sheet. */
export const num = (value: string): string => `<bdi>${esc(value)}</bdi>`;

/** A4's printable box at Excel's «Normal» margins, in CSS px. */
export const BOX_W = (210 / 25.4) * 96 - 1.4 * 96;
export const BOX_H = (297 / 25.4) * 96 - 1.5 * 96;

/**
 * One A4 sheet holding a memo drawn `w` × `h` — shrunk to fit the page when it is larger (never
 * grown), or drawn at the given `scale`.
 */
export const memoPage = (w: number, h: number, body: string, scale?: number): string => {
  const s = Math.min(scale ?? Math.min(1, BOX_H / h), BOX_W / w, 1);
  return `<style>${MEMO_CSS}</style><div class="xm-sheet" data-paper-sheet="true"><div class="xm-box"><div class="xm-paper" data-xm-paper="true" style="width:${n(w)}px;height:${n(h)}px${s < 1 ? `;transform:scale(${s.toFixed(4)})` : ''}">${body}</div></div></div>`;
};

// ── Run-on pages ─────────────────────────────────────────────────────────────────────────────────

/** Down to here the whole memo is shrunk onto one page; a longer one runs on at 100%. */
export const LEAST_SCALE = 0.75;
/** The fewest rows the last page of a run-on memo carries with its total and names. */
export const LEAST_LAST = 5;

export interface RunOnPage {
  /** Rows `from`..`to` (exclusive) of the memo. */
  from: number;
  to: number;
  /** The memo's top (title, band, header) is on this page — the first. */
  top: boolean;
  /** The total and the names are on this page — the last. */
  foot: boolean;
  /** The page's scale: the one page shrunk to fit, or 1 on a run-on page. */
  scale: number;
}

/**
 * A memo's pages. The whole memo on one page, shrunk to fit, when it fits at `LEAST_SCALE` or
 * more; else Excel's own page breaks at 100% — the top on the first page, the total and the names
 * on the last, which never carries fewer than `LEAST_LAST` rows (the sample's fuel loop, for all
 * four memos). `g` is the memo's geometry: its top's height, a row's, and its foot's (total row
 * and names).
 */
export const planRunOn = (
  count: number,
  g: { top: number; row: number; foot: number },
): RunOnPage[] => {
  const tall = g.top + count * g.row + g.foot;
  if (BOX_H / tall >= LEAST_SCALE) {
    return [{ from: 0, to: count, top: true, foot: true, scale: Math.min(1, BOX_H / tall) }];
  }
  const pages: RunOnPage[] = [];
  let at = 0;
  let first = true;
  for (;;) {
    const height = BOX_H - (first ? g.top : 0);
    const room = Math.floor(height / g.row);
    const rest = count - at;
    if (rest * g.row + g.foot <= height) {
      pages.push({ from: at, to: count, top: first, foot: true, scale: 1 });
      return pages;
    }
    // The foot does not fit under the rest: carry at least LEAST_LAST rows over with it, so the
    // last page never holds one lone row.
    const take = Math.max(1, Math.min(room, rest - LEAST_LAST));
    pages.push({ from: at, to: at + take, top: first, foot: false, scale: 1 });
    at += take;
    first = false;
  }
};

// ── Excel's «shrink to fit», measured ────────────────────────────────────────────────────────────

/** Roughly how wide a Calibri-bold line is, in ems — where it cannot be measured. */
const widthEm = (words: string): number =>
  [...words].reduce((sum, ch) => {
    if (ch === ' ') return sum + 0.226;
    if (/[0-9]/u.test(ch)) return sum + 0.507;
    if (/[\u0600-\u06FF]/u.test(ch)) return sum + 0.45;
    return sum + 0.5;
  }, 0);

/**
 * A Calibri-bold cell's text at `pt`, made smaller (by quarter points) until it fits `room` px —
 * Excel's «shrink to fit», as his maintenance sheet's long «البيان» lines are.
 */
export const shrinkPt = (words: string, pt: number, room: number, least = 6): number => {
  const width = (size: number): number =>
    measureText(words, `700 ${size}pt ${STACK.cal}`) ?? widthEm(words) * px(size);
  let size = pt;
  if (width(size) <= room) return size;
  size = Math.max(least, Math.floor(((pt * room) / width(pt)) * 4) / 4);
  while (size > least && width(size) > room) size -= 0.25;
  return size;
};

/** The looks his cells are written in. */
export const cal = (pt: number, b = true, u = false): Look => ({ f: 'cal', pt, b, u });
export const ari = (pt: number, b = true, u = false): Look => ({ f: 'ari', pt, b, u });
export const art = (pt: number): Look => ({ f: 'art', pt, b: false });
/** The fuel sheet's Arabic table cells (bold, as the sheet is; the words small, as his). */
export const ark = (pt: number): Look => ({ f: 'ark', pt, b: true });
/** The fuel sheet's two small lines over it — the company and its department — packed tight. */
export const arh = (pt: number): Look => ({ f: 'arh', pt, b: true });
