// The four Excel memos — his maintenance, tyres (and washing) and fuel sheets, line for line.
//
// Every geometry number, pt size, offset and call order is his sheet's, measured off his files and
// approved in the sample. Nothing his papers do not have is added: no memo number, no name, no
// date, no period — «اسم المذكرة» is the app's and the PDF's, never the paper's. The tyres and
// washing titles are always his.
//
// A long memo runs on to more pages (`planRunOn`): shrunk onto one page down to 75%, otherwise
// Excel's own breaks at 100%, the top on the first page, the total and the names on the last.
import type {
  FleetCustodyPaperSignatures,
  FleetCustodySignBlock,
  FleetCustodySignRole,
  FleetCustodySource,
} from '@ecms/contracts';
import { dMy, esc, fixed2, general, grouped, r2 } from './custody-paper-format';
import {
  ari,
  arh,
  ark,
  art,
  boxAround,
  cal,
  cell,
  fill,
  grid,
  hl,
  logo,
  memoPage,
  num,
  planRunOn,
  shrinkPt,
  signLine,
  text,
  textMid,
  vl,
} from './custody-paper-excel';
import {
  FUEL_WORDS,
  MAINTENANCE_WORDS,
  MEMO_COMPANY,
  MEMO_DEPT,
  TYRES_WORDS,
} from './custody-paper-wording';

export interface MemoPaperLine {
  /** The car's code, exactly as stored. */
  code: string;
  /** YYYY-MM-DD. */
  date: string;
  amount: number;
  /** «المأموريه» — fuel only. */
  mission?: string | null;
  /** «البيان» — maintenance only. */
  statement?: string | null;
  /** «ملاحظات» — fuel and maintenance. */
  note?: string | null;
}

export interface MemoPaperInput {
  kind: FleetCustodySource;
  /** In the memo's order: the receipt's day ascending, then the receipt's creation. */
  lines: readonly MemoPaperLine[];
  signatures: FleetCustodyPaperSignatures;
}

/** The memo's total, to the piastre. */
export const memoTotal = (lines: readonly MemoPaperLine[]): number =>
  r2(lines.reduce((sum, line) => sum + line.amount, 0));

const ARABIC = /[\u0600-\u06FF]/u;

/** The block printed for a role — none when it is switched off for this paper. */
const blockOf = (
  signs: FleetCustodyPaperSignatures,
  role: FleetCustodySignRole,
): FleetCustodySignBlock | undefined => signs.blocks.find((b) => b.role === role && b.on);

/** Rows `from`..`to` of a memo, its top on the first page and its foot on the last. */
interface Part {
  html: string;
  h: number;
}
type Body = (input: MemoPaperInput, from: number, to: number, top: boolean, foot: boolean) => Part;

// ── His maintenance sheet (image 126, at 100%) ───────────────────────────────────────────────────

const M_W = 610;
// م 46 | البيان 265 | الاجمالى 122 | ملاحظات 177 — from the right.
const M_X = [0, 46, 311, 433, 610] as const;
const M_TOP = 154;
const M_ROW = 64 / 3;
const M_FOOT = 22 + 316;

const maintenanceBody: Body = (input, from, to, top, foot) => {
  const W = M_W;
  const X = M_X;
  const [, xM, xBayan, xTotal] = X;
  const signs = input.signatures;
  const o: string[] = [];
  let y = 0;
  if (top) {
    o.push(cell(2, 0, 440, 22, esc(MEMO_COMPANY), ari(11), { a: 'r' }));
    o.push(cell(26, 22, 300, 22, esc(MEMO_DEPT), ari(11), { a: 'r' }));
    // He stretched the logo across the cell: 123 × 34, not its natural 101 × 34.
    o.push(logo(W - 9 - 123, 5, 123, 34));
    o.push(cell(3, 66, 604, 22, esc(MAINTENANCE_WORDS.request), ari(14, false), { a: 'r' }));
    // The band and the header.
    o.push(cell(0, 110, W, 22, esc(MAINTENANCE_WORDS.band), cal(13)));
    MAINTENANCE_WORDS.heads.forEach((head, i) => {
      o.push(cell(X[i] ?? 0, 132, (X[i + 1] ?? 0) - (X[i] ?? 0), 22, esc(head), cal(13)));
    });
    y = M_TOP;
  }
  // The lines — 16pt rows.
  const rowH = M_ROW;
  const ys = [y];
  for (let i = from; i < to; i += 1) {
    const line = input.lines[i];
    if (line === undefined) continue;
    o.push(cell(0, y, xM, rowH, num(String(i + 1)), cal(13)));
    const statement = line.statement ?? '';
    o.push(
      cell(xM, y, xBayan - xM, rowH, esc(statement), cal(shrinkPt(statement, 11, xBayan - xM - 6))),
    );
    o.push(cell(xBayan, y, xTotal - xBayan, rowH, num(general(line.amount)), cal(10)));
    o.push(cell(xTotal, y, W - xTotal, rowH, esc(line.note ?? ''), cal(10)));
    y += rowH;
    ys.push(y);
  }
  const yTot = y;
  const T = yTot + 22;
  const total = memoTotal(input.lines);
  if (foot) {
    // His total label sits in the middle of its row, not at the foot.
    o.push(cell(0, yTot, xBayan, 22, esc(MAINTENANCE_WORDS.total), art(9), { v: 'm' }));
    o.push(cell(xBayan, yTot, xTotal - xBayan, 22, num(fixed2(total)), cal(13)));
  }
  if (top) o.push(boxAround(0, W, 110, 132));
  // (The header's foot, 154, is drawn twice on the first page, as the sample draws it.)
  o.push(grid([...X], top ? [132, M_TOP, ...ys] : ys));
  if (!foot) return { html: o.join(''), h: y };
  o.push(hl(T, 0, W));
  o.push(...[0, xBayan, xTotal, W].map((x) => vl(x, yTot, T)));
  // «الاجمالى النهائى للمصروفات» — top border, double bottom border, on the total's column only.
  o.push(cell(113, T + 14, 320, 22, esc(MAINTENANCE_WORDS.grand), cal(10), { a: 'r', v: 'm' }));
  o.push(cell(xBayan, T + 14, xTotal - xBayan, 23, num(fixed2(total)), cal(13)));
  o.push(hl(T + 14, xBayan, xTotal), hl(T + 37, xBayan, xTotal), hl(T + 39, xBayan, xTotal));
  // The names: the preparer at the right, the director lower down at the left.
  const prep = blockOf(signs, 'preparer');
  if (prep !== undefined) {
    o.push(text(prep.office, cal(12), T + 58, { right: 139 }));
    o.push(text(prep.name, cal(12), T + 79, { right: 50 }));
    o.push(signLine(MAINTENANCE_WORDS.sign, cal(12), T + 98, 50, 393));
  }
  const dir = blockOf(signs, 'director');
  if (dir !== undefined) {
    o.push(text(dir.office, cal(12), T + 132, { left: 0 }));
    o.push(text(dir.name, cal(12), T + 153, { right: W - 174 }));
    o.push(signLine(MAINTENANCE_WORDS.sign, cal(12), T + 172, W - 174, 6));
  }
  const gm = blockOf(signs, 'endorser');
  if (gm !== undefined) {
    if (signs.note.trim() !== '') {
      o.push(text(signs.note, cal(10, true, true), T + 219, { center: W / 2 }));
    }
    o.push(text(gm.name, cal(12), T + 251, { center: W / 2 }));
    o.push(signLine(MAINTENANCE_WORDS.finalSign, cal(12), T + 286, 5, 354));
  }
  return { html: o.join(''), h: T + 316 };
};

// ── His tyres sheet, and the washing one (121 / 127, at 80% → 100%) ──────────────────────────────

const T_W = 375;
// م 37.5 | الكود 156 | القيمة 94 — then two blank columns of 44.
const T_X = [0, 37.5, 193.5, 287.5] as const;
const T_HEAD = 102.75;
const T_TOP = T_HEAD + 18.75;
const T_ROW = 21.25;
const T_FOOT = T_ROW + 322;
/** His title's two trailing underlined spaces. */
const TITLE_TAIL = '  ';

const tyresBody: Body = (input, from, to, top, foot) => {
  const X = T_X;
  const [, xM, xCode, TW] = X;
  const signs = input.signatures;
  const kind = input.kind === 'wash' ? 'wash' : 'tyres';
  const o: string[] = [];
  const yH = T_HEAD;
  let y = 0;
  if (top) {
    // The logo alone over the table, its left edge on the table's left border.
    o.push(logo(TW - 120, 1, 120, null));
    // The title box: three columns over two rows, a box, no fill; underlined with its two
    // trailing spaces. Always his title — the memo's name is never printed.
    o.push(
      cell(0, 41.5, TW, 42.5, esc(`${TYRES_WORDS.title[kind]}${TITLE_TAIL}`), cal(13, true, true), {
        v: 'm',
      }),
    );
    o.push(boxAround(0, TW, 41.5, 84));
    o.push(
      cell(0, 84, TW, 18.75, esc(TYRES_WORDS.band[kind]), cal(13, false), { fill: '#d9d9d9' }),
    );
    o.push(fill(0, yH, TW, 18.75, '#d9d9d9'));
    const [hM = '', hCode = '', hValue = ''] = TYRES_WORDS.heads;
    o.push(cell(0, yH, xM, 18.75, esc(hM), cal(14, false)));
    o.push(cell(xM, yH, xCode - xM, 18.75, esc(hCode), cal(14, false)));
    o.push(cell(xCode, yH, TW - xCode, 18.75, esc(hValue), cal(14, false), { a: 'r' }));
    y = T_TOP;
  }
  const rowH = T_ROW;
  const ys = [y];
  for (let i = from; i < to; i += 1) {
    const line = input.lines[i];
    if (line === undefined) continue;
    o.push(cell(0, y, xM, rowH, num(String(i + 1)), cal(12)));
    // A code in Arabic letters («تويوتا 1») was typed in Arial on his sheet.
    o.push(
      cell(xM, y, xCode - xM, rowH, esc(line.code), ARABIC.test(line.code) ? ari(13) : cal(12)),
    );
    o.push(cell(xCode, y, TW - xCode, rowH, num(general(line.amount)), cal(12)));
    y += rowH;
    ys.push(y);
  }
  if (!foot) {
    if (top) o.push(boxAround(0, TW, 84, yH));
    o.push(grid([...X], top ? [yH, ...ys] : ys));
    return { html: o.join(''), h: y };
  }
  const yTot = y;
  const T = yTot + rowH;
  ys.push(T);
  o.push(cell(xM, yTot, xCode - xM, rowH, esc(TYRES_WORDS.total), art(13), { a: 'r' }));
  o.push(cell(xCode, yTot, TW - xCode, rowH, num(general(memoTotal(input.lines))), cal(12)));
  if (top) o.push(boxAround(0, TW, 84, yH));
  o.push(grid([...X], top ? [yH, ...ys] : ys));
  // The names, centred where he centred them; the two small «التوقيع» lines in 8pt.
  const prep = blockOf(signs, 'preparer');
  if (prep !== undefined) {
    o.push(text(prep.office, ari(10), T + 25, { center: 175 }));
    o.push(text(prep.name, ari(10), T + 42, { center: 190 }));
    o.push(signLine(TYRES_WORDS.sign, ari(8), T + 70, 89, 49));
  }
  const dir = blockOf(signs, 'director');
  if (dir !== undefined) {
    o.push(text(dir.office, ari(10), T + 120, { center: 147 }));
    o.push(text(dir.name, ari(10), T + 139, { center: 162 }));
    o.push(signLine(TYRES_WORDS.sign, ari(8), T + 162, 44, 95));
  }
  const gm = blockOf(signs, 'endorser');
  if (gm !== undefined) {
    if (signs.note.trim() !== '') {
      o.push(text(signs.note, ari(10, true, true), T + 229, { center: TW / 2 }));
    }
    o.push(text(gm.name, cal(13), T + 260, { center: TW / 2 }));
    o.push(signLine(TYRES_WORDS.finalSign, cal(12), T + 292, 5, 70));
  }
  return { html: o.join(''), h: T + 322 };
};

// ── His fuel sheet (128, R = one row) ────────────────────────────────────────────────────────────

/**
 * One data row's height. His rows are tight: R = 15u. His digits stand 0.67R tall — Arial bold
 * at 10.5pt (`DATA`); the words around the table are measured against D = 12pt.
 */
const R = 15;
const D = 12;
const DATA = 10.5;
/**
 * His Arabic in the table — the missions, an Arabic code, the header's words — is smaller than his
 * figures, so it stays inside his tight rows: 0.8 of the figures' size, the header 0.75.
 */
const DATA_AR = 0.8 * DATA;
/** The header's words — «المأموريه»'s hamza needs the room. */
const HEAD_AR = 0.75 * DATA;
/** His figures sit lower in the row than Excel's usual 2u — 1.5u under the line above. */
const SINK = 0.7;
const FUEL_W = 622;
// A «م» | B «الكود» | C «التاريخ» | D «المبلغ» | E «المأموريه» | F «ملاحظات» | G (blank) — from the right.
const FX = [0, 38, 146, 241, 328, 437, 541, 622] as const;
/** The memo's top (company, department, title) and its column header, in rows. */
const FUEL_TOP = 4.5;
/** The total row and the three name blocks under it, in rows. */
const FUEL_FOOT = 18;

const fuelBody: Body = (input, from, to, top, foot) => {
  const [, xA, xB, xC, xD, xE, xF] = FX;
  const W = FUEL_W;
  const signs = input.signatures;
  const o: string[] = [];
  const data = ari(DATA);
  // A cell in Arabic (a mission, a code like «جبلي»): smaller than the figures, in the row's
  // middle (his: ink from 0.2R to 0.8R, its tail included).
  const said = (x: number, y: number, w: number, value: string): string =>
    ARABIC.test(value)
      ? cell(x, y, w, R, esc(value), ark(DATA_AR), { v: 'm' })
      : cell(x, y, w, R, esc(value), data, { drop: SINK });
  let y = 0;
  if (top) {
    o.push(cell(-1, 0, 420, 0.9 * R, esc(MEMO_COMPANY), arh(0.9 * D), { a: 'r' }));
    o.push(cell(1.6 * R - 3, 0.9 * R, 300, 0.8 * R, esc(MEMO_DEPT), arh(0.9 * D), { a: 'r' }));
    const logoH = 1.9 * R;
    const logoW = (logoH * 560) / 188;
    o.push(logo(W - (W - xF) - 0.6 * R - logoW, 0.6 * R, logoW, null));
    // The title sits in the middle of its tall row, underlined under the words only.
    o.push(
      cell(0, 1.7 * R, xF, 1.8 * R, esc(FUEL_WORDS.title), ari(0.8 * D, true, true), { v: 'm' }),
    );
    y = 3.5 * R;
    // The header: grey on A..F, every line.
    o.push(fill(0, y, xF, R, '#d9d9d9'));
    FUEL_WORDS.heads.forEach((head, i) => {
      o.push(
        cell(FX[i] ?? 0, y, (FX[i + 1] ?? 0) - (FX[i] ?? 0), R, esc(head), ark(HEAD_AR), {
          v: 'm',
          drop: 0.3,
        }),
      );
    });
    o.push(grid([0, xA, xB, xC, xD, xE, xF], [y, y + R]));
    y += R;
  }
  const yRows = y;
  const ys = [y];
  for (let i = from; i < to; i += 1) {
    const line = input.lines[i];
    if (line === undefined) continue;
    o.push(cell(0, y, xA, R, num(String(i + 1)), data, { fill: '#d9d9d9', drop: SINK }));
    o.push(said(xA, y, xB - xA, line.code));
    o.push(cell(xB, y, xC - xB, R, num(dMy(line.date)), data, { drop: SINK }));
    o.push(cell(xC, y, xD - xC, R, num(general(line.amount)), data, { drop: SINK }));
    o.push(said(xD, y, xE - xD, line.mission ?? ''));
    if ((line.note ?? '') !== '') o.push(said(xE, y, xF - xE, line.note ?? ''));
    y += R;
    ys.push(y);
  }
  if (!foot) {
    o.push(grid([0, xA, xB, xC, xD, xE], ys));
    o.push(vl(xF, top ? 3.5 * R : yRows, y));
    return { html: o.join(''), h: y };
  }
  // The total row: A..E grey (#D0CECE) and boxed, only the amount in it; F open.
  o.push(fill(0, y, xE, R, '#d0cece'));
  o.push(
    cell(xC, y, xD - xC, R, num(grouped(memoTotal(input.lines))), data, { a: 'r', drop: SINK }),
  );
  ys.push(y + R);
  o.push(...[0, xA, xB, xC, xD, xE].map((x) => vl(x, y, y + R)));
  const T = y + R;
  // «ملاحظات» has no row lines — only its outer border and the E|F line, down to the total's foot.
  o.push(grid([0, xA, xB, xC, xD, xE], ys.slice(0, -1)));
  o.push(hl(T, 0, xE));
  o.push(vl(xF, top ? 3.5 * R : yRows, T));
  // The accountant under «الكود», the director and the general manager down the middle.
  const at = (share: number): number => share * W;
  const prep = blockOf(signs, 'preparer');
  if (prep !== undefined) {
    o.push(textMid(prep.office, art(0.8 * D), T + 0.6 * R, { right: xA + 7 }));
    o.push(textMid(prep.name, ari(0.8 * D), T + 1.85 * R, { right: xA + 9 }));
    o.push(textMid(FUEL_WORDS.prepSign, ari(0.8 * D), T + 2.8 * R, { right: xA + 9 }));
  }
  const dir = blockOf(signs, 'director');
  if (dir !== undefined) {
    // His fuel paper breaks the office over two lines: the last word under the rest.
    const words = dir.office.trim().split(/\s+/u);
    const last = words.length > 1 ? (words.pop() ?? '') : '';
    o.push(textMid(words.join(' '), ari(0.8 * D), T + 5.3 * R, { right: at(0.604) }));
    if (last !== '') o.push(textMid(last, ari(0.9 * D), T + 6.25 * R, { right: at(0.522) }));
    o.push(textMid(dir.name, ari(0.85 * D), T + 7.35 * R, { right: at(0.583) }));
    o.push(signLine(FUEL_WORDS.dirSign, ari(0.8 * D), T + 8.5 * R, at(0.534), 1, true));
  }
  const gm = blockOf(signs, 'endorser');
  if (gm !== undefined) {
    if (signs.note.trim() !== '') {
      o.push(
        textMid(signs.note, ari(0.85 * D, true, true), T + 12.2 * R, { center: (xD + xE) / 2 }),
      );
    }
    if (gm.office !== '') {
      o.push(textMid(gm.office, ari(0.88 * D), T + 13.25 * R, { right: at(0.534) }));
    }
    o.push(textMid(gm.name, ari(0.95 * D), T + 14.4 * R, { center: 389 }));
    o.push(signLine(FUEL_WORDS.gmSign, ari(0.85 * D), T + 15.8 * R, at(0.534), at(0.039), true));
  }
  return { html: o.join(''), h: T + 17 * R };
};

// ── The memos as A4 sheets ───────────────────────────────────────────────────────────────────────

const MEMO_LAYOUT: Record<
  FleetCustodySource,
  { w: number; body: Body; g: { top: number; row: number; foot: number } }
> = {
  maintenance: { w: M_W, body: maintenanceBody, g: { top: M_TOP, row: M_ROW, foot: M_FOOT } },
  tyres: { w: T_W, body: tyresBody, g: { top: T_TOP, row: T_ROW, foot: T_FOOT } },
  wash: { w: T_W, body: tyresBody, g: { top: T_TOP, row: T_ROW, foot: T_FOOT } },
  fuel: { w: FUEL_W, body: fuelBody, g: { top: FUEL_TOP * R, row: R, foot: FUEL_FOOT * R } },
};

/**
 * A memo as A4 sheets — one self-contained HTML string per sheet (its own `<style>`), so the
 * preview frames them one by one and the printer gets them one to a page.
 */
export const memoSheets = (input: MemoPaperInput): string[] => {
  const layout = MEMO_LAYOUT[input.kind];
  return planRunOn(input.lines.length, layout.g).map((page) => {
    const part = layout.body(input, page.from, page.to, page.top, page.foot);
    return memoPage(layout.w, part.h, part.html, page.scale);
  });
};
