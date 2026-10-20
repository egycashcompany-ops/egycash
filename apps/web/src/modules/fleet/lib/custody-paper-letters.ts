// The three Word letters — «صرف عهدة» (a charge), «استعاضه عهدة» (a replenishment) and «تسويه
// عهدة» (a settlement) — paragraph by paragraph, as his .docx files lay them out.
//
// Digits: Arabic-Indic everywhere (Word's «Context» numerals), except the settle letter's table
// amounts and total, typed in a Latin run on his letter (`latin2`). The bracket figure — the
// replenish letter's «عهده اداره الحركه ( X )», the settle letter's «من العهده ( X )» — is the
// operation's `letterFigure`, frozen when it was recorded, so a reprint never changes.
import type {
  FleetCustodyPaperSignatures,
  FleetCustodySignBlock,
  FleetCustodySignRole,
  FleetCustodySource,
  FleetLicenseExpenseKind,
} from '@ecms/contracts';
import { ai, aiAmount, esc, latin2, tatweelDate } from './custody-paper-format';
import { CENTER, blank, letterPage, para, signer1, signer2, signer3 } from './custody-paper-word';
import {
  BODY_ORDER,
  CHARGE_FOR,
  KIND_WORD,
  LETTER_TITLE,
  LETTER_WORDS,
  REASON_LEAD,
  TABLE_ORDER,
  chargeReason,
  chargeRequest,
  replenishBody,
  settleBody,
  settleRowLabel,
} from './custody-paper-wording';

export interface ReplenishLetterInput {
  kind: 'replenish';
  /** YYYY-MM-DD — the letter's date. */
  date: string;
  /** YYYY-MM-DD; null prints the letter's date. */
  from: string | null;
  to: string | null;
  amount: number;
  /** The bracket figure «عهده اداره الحركه ( X )». */
  custody: number;
  /** One per kind with an amount, in `TABLE_ORDER` (`replenishRowsOf`). */
  rows: readonly { kind: FleetCustodySource; amount: number }[];
  signatures: FleetCustodyPaperSignatures;
}
export interface SettleLetterInput {
  kind: 'settle';
  date: string;
  from: string | null;
  to: string | null;
  amount: number;
  /** The bracket figure «من العهده ( X )». */
  custody: number;
  /** One per licensing memo, oldest first (`settleRowsOf`). */
  rows: readonly { part: FleetLicenseExpenseKind; cars: number; amount: number }[];
  signatures: FleetCustodyPaperSignatures;
}
export interface ChargeLetterInput {
  kind: 'charge';
  date: string;
  amount: number;
  /** «وذلك نظير …» — a leading «نظير» is dropped; empty drops the second paragraph. */
  reason: string;
  signatures: FleetCustodyPaperSignatures;
}
export type LetterPaperInput = ReplenishLetterInput | SettleLetterInput | ChargeLetterInput;

const blockOf = (
  signs: FleetCustodyPaperSignatures,
  role: FleetCustodySignRole,
): FleetCustodySignBlock | undefined => signs.blocks.find((b) => b.role === role && b.on);

const signsOf = (
  signs: FleetCustodyPaperSignatures,
): Record<'s1' | 's2' | 's3', FleetCustodySignBlock | undefined> => ({
  s1: blockOf(signs, 'director'),
  s2: blockOf(signs, 'finance'),
  s3: blockOf(signs, 'endorser'),
});

// ── Paging: Word's page, in points ────────────────────────────────────────────────────────────
//
// Every height on these letters is fixed by the letter itself — each paragraph's line, Word's 8pt
// after it, each table row's height — but for how many lines a paragraph of words wraps onto,
// which depends on the face the printer has. That is estimated generously (a wider average
// letter than Times New Roman or its fallbacks draw), so a sheet is closed a little early rather
// than ever printing past the margin. Calibrated by rendering: a settle row is 16.85pt, a
// replenish row 19.15pt, the column heads 19.6pt.

/**
 * A4's 841.89pt less Word's 1in margins, top and bottom: where the body may run — the last
 * paragraph's 8pt after it may fall past the margin, as Word lets it.
 */
const ROOM = 841.89 - 72 - 72 + 8;
/** Word's «8pt after» on every paragraph. */
const AFTER = 8;
/** The body's width — A4's 595.28pt less the two 1in margins. */
const WIDTH = 595.28 - 144;
/** The second signer's column (`signer2`'s indents) and the general manager's (`signer3`'s). */
const SIGNER2_WIDTH = WIDTH - 238 + 40.5;
const SIGNER3_WIDTH = WIDTH - 216 + 58.5;
/** An average letter's advance, in ems — generous: his faces and their fallbacks draw ~0.40. */
const EM_PER_LETTER = 0.44;
const HEAD_ROW = 19.6;
const SETTLE_ROW = 17;
const REPLENISH_ROW = 19.3;

interface Block {
  html: string;
  /** Its height with the 8pt after it, in points. */
  h: number;
}
interface LetterTable {
  open: string;
  /** «م · المذكره · القيمه» — repeated at the top of every sheet the table runs onto. */
  heads: string;
  rows: string[];
  total: string;
  close: string;
  headH: number;
  rowH: number;
}

/** How many lines `text` wraps onto at `pt` across `width` — estimated generously. */
const linesOf = (text: string, pt: number, width = WIDTH): number =>
  Math.max(1, Math.ceil((text.length * pt * EM_PER_LETTER) / width));

/** A paragraph's text without its tags — what it wraps. */
const plain = (html: string): string =>
  html.replace(/<[^>]+>/gu, '').replace(/&(?:lt|gt|quot|amp|#\d+);/gu, '_');

/** A signer's three paragraphs: his office and his name (each may wrap), the «التوقيع» line. */
const signerH = (b: FleetCustodySignBlock, pt: number, lh: number, width: number): number =>
  (linesOf(b.office, pt, width) + linesOf(b.name, pt, width) + 1) * lh + 3 * AFTER;

const heightOf = (blocks: readonly Block[]): number => blocks.reduce((sum, b) => sum + b.h, 0);
const htmlOf = (blocks: readonly Block[]): string => blocks.map((b) => b.html).join('');

/**
 * The fund letters' sheets: the head, the table, the closing and the signers on one sheet when
 * they fit — exactly his letter — else the table's rows run on over as many sheets as they need,
 * at least two of them carried to the last sheet with the total, the closing and the signers.
 */
const tableSheets = (
  head: readonly Block[],
  table: LetterTable,
  tail: readonly Block[],
): string[] => {
  const sheets: string[] = [];
  const tailH = heightOf(tail);
  const rows = table.rows;
  let at = 0;
  for (let first = true; ; first = false) {
    const top = first ? heightOf(head) : 0;
    const room = ROOM - top - table.headH;
    const left = rows.length - at;
    const lastFits = left * table.rowH + table.rowH + tailH <= room;
    // Everything left fits here — or nothing more would fit anywhere: this is the last sheet.
    const take = lastFits
      ? left
      : Math.max(0, Math.min(Math.floor(room / table.rowH), left - Math.min(left, 2)));
    const last = lastFits || (!first && take === 0);
    const part = last ? rows.slice(at) : rows.slice(at, at + take);
    const tableHtml =
      part.length === 0 && !last
        ? ''
        : `${table.open}${table.heads}${part.join('')}${last ? table.total : ''}${table.close}`;
    sheets.push(letterPage(`${first ? htmlOf(head) : ''}${tableHtml}${last ? htmlOf(tail) : ''}`));
    if (last) return sheets;
    at += take;
  }
};

const LEADING_REASON = new RegExp(`^${REASON_LEAD}\\s*`, 'u');

/** The typed reason as the letter prints it: trimmed, a leading «نظير» dropped, digits his. */
const reasonOf = (reason: string): string => ai(reason.trim().replace(LEADING_REASON, ''));

/**
 * «صرف عهدة»'s request as plain text — what the charge dialog shows under «نص الخطاب», and the
 * letter's `.body` word for word.
 */
export const chargeLetterSentence = (input: { amount: number; reason: string }): string => {
  const reason = reasonOf(input.reason);
  const request = chargeRequest(aiAmount(input.amount));
  return reason === '' ? request : `${request}${CHARGE_FOR}${chargeReason(reason)}`;
};

/** «صرف عهدة» — the .docx itself, paragraph by paragraph; its closing and signers move to a
 * second sheet, together, when a long reason leaves them no room on the first (as Word would). */
const chargeLetter = (input: ChargeLetterInput): string[] => {
  const [y = '', m = '', d = ''] = input.date.split('-');
  const { s1, s2, s3 } = signsOf(input.signatures);
  const reason = reasonOf(input.reason);
  const request = chargeRequest(aiAmount(input.amount));
  // His two body paragraphs, as one block: the request, then the reason after a Word line break.
  const body =
    reason === ''
      ? request
      : `${request}${CHARGE_FOR}<span class="wl-br"></span>${chargeReason(esc(reason))}`;
  const bodyLines =
    linesOf(request + (reason === '' ? '' : CHARGE_FOR), 18) +
    (reason === '' ? 0 : linesOf(chargeReason(reason), 18));
  const head: Block[] = [
    {
      html: para(
        `<span style="font-size:10pt">${esc(LETTER_WORDS.date)}</span> ${ai(`${Number(d)}/${Number(m)}/${y}`)}`,
        14,
        17.4,
      ),
      h: 18.9 + AFTER,
    },
    {
      html: para(`<span class="wl-u">${esc(LETTER_TITLE.charge)}</span>`, 20, 24.8, CENTER),
      h: 24.8 + AFTER,
    },
    { html: blank(22.3), h: 22.3 + AFTER },
    {
      html: `<div class="body" style="font-size:18pt;line-height:22.3pt">${body}</div>`,
      h: bodyLines * 22.3 + (reason === '' ? 0 : 8) + AFTER,
    },
    { html: blank(13.65), h: 13.65 + AFTER },
    { html: blank(13.65), h: 13.65 + AFTER },
  ];
  const tail: Block[] = [
    { html: para(esc(LETTER_WORDS.close), 16, 19.9, CENTER), h: 19.9 + AFTER },
    { html: para(esc(LETTER_WORDS.regards), 16, 18.4, CENTER), h: 18.4 + AFTER },
    ...(s1 === undefined ? [] : [{ html: signer1(s1, 16, 18.4), h: signerH(s1, 16, 18.4, WIDTH) }]),
    ...(s1 === undefined || s2 === undefined ? [] : [{ html: blank(18.4), h: 18.4 + AFTER }]),
    ...(s2 === undefined
      ? []
      : [{ html: signer2(s2, 16, 18.4), h: signerH(s2, 16, 18.4, SIGNER2_WIDTH) }]),
    ...(s3 === undefined
      ? []
      : [
          {
            html: `${blank(20.7)}${blank(20.7)}${blank(20.7)}${signer3(s3, 18, 20.7)}`,
            h: 3 * (20.7 + AFTER) + signerH(s3, 18, 20.7, SIGNER3_WIDTH),
          },
        ]),
  ];
  return heightOf(head) + heightOf(tail) <= ROOM
    ? [letterPage(htmlOf([...head, ...tail]))]
    : [letterPage(htmlOf(head)), letterPage(htmlOf(tail))];
};

/** «استعاضه عهدة» (124) and «تسويه عهدة» (129) — the same letter, the settle one a Word size smaller. */
const fundLetter = (input: ReplenishLetterInput | SettleLetterInput): string[] => {
  const replenish = input.kind === 'replenish';
  const [y = '', m = '', d = ''] = input.date.split('-');
  const { s1, s2, s3 } = signsOf(input.signatures);
  // Sizes: date · title · greeting · body · closing · signers (replenish 12/18/16/14/16/14,
  // settle 11/16/14/12/14/12).
  const z = replenish
    ? {
        date: [12, 14.9],
        title: [18, 22.3],
        greet: [16, 19.9],
        body: [14, 17.4],
        close: [16, 19.9, 18.4],
        sign: [14, 16.1],
      }
    : {
        date: [11, 13.65],
        title: [16, 19.9],
        greet: [14, 17.4],
        body: [12, 14.9],
        close: [14, 17.4, 16.1],
        sign: [12, 13.8],
      };
  const [dPt = 12, dLh = 14.9] = z.date;
  const [tPt = 18, tLh = 22.3] = z.title;
  const [gPt = 16, gLh = 19.9] = z.greet;
  const [bPt = 14, bLh = 17.4] = z.body;
  const [cPt = 16, cLh = 19.9, cLh2 = 18.4] = z.close;
  const [sPt = 14, sLh = 16.1] = z.sign;
  const dateWord = esc(LETTER_WORDS.date);
  const dateLine = replenish
    ? `${dateWord}${ai(d.padStart(2, '0'))}/ ${ai(m)} / ${ai(y)}`
    : `${dateWord} ${ai(String(Number(d)))} / ${ai(m)} / ${ai(y)}`;
  const from = input.from ?? input.date;
  const to = input.to ?? input.date;
  let body: string;
  let table: LetterTable;
  if (input.kind === 'replenish') {
    const present = new Set(input.rows.map((row) => row.kind));
    const kinds = BODY_ORDER.filter((kind) => present.has(kind)).map((kind) => KIND_WORD[kind]);
    body = replenishBody(
      aiAmount(input.amount),
      aiAmount(input.custody),
      tatweelDate(from, true),
      tatweelDate(to, true),
      kinds.map(esc),
    );
    const [hNo = '', hMemo = '', hValue = ''] = LETTER_WORDS.tableHeads;
    table = {
      open: '<table class="wl-t ar n4" style="width:463.8pt;margin-right:-5.4pt;font-family:var(--arial);font-size:16pt;line-height:18.4pt"><colgroup><col style="width:132.4pt" /><col style="width:176.5pt" /><col style="width:154.9pt" /></colgroup><tbody>',
      heads: `<tr style="height:19.6pt"><td>${esc(hNo)}</td><td>${esc(hMemo)}</td><td>${esc(hValue)}</td></tr>`,
      rows: input.rows.map(
        (row, i) =>
          `<tr style="height:18.7pt"><td>${ai(String(i + 1))}</td><td>${esc(KIND_WORD[row.kind])}</td><td>${aiAmount(row.amount)}</td></tr>`,
      ),
      total: `<tr style="height:18.7pt"><td>${esc(LETTER_WORDS.replenishTotal)}</td><td></td><td>${aiAmount(input.amount)}</td></tr>`,
      close: '</tbody></table>',
      headH: HEAD_ROW,
      rowH: REPLENISH_ROW,
    };
  } else {
    body = settleBody(
      aiAmount(input.amount),
      aiAmount(input.custody),
      tatweelDate(from, false),
      tatweelDate(to, false),
    );
    const [hNo = '', hMemo = '', hValue = ''] = LETTER_WORDS.tableHeads;
    table = {
      open: '<table class="wl-t" style="width:456pt;font-size:14pt;line-height:16.1pt"><colgroup><col style="width:148.9pt" /><col style="width:197.6pt" /><col style="width:109.6pt" /></colgroup><tbody>',
      heads: `<tr style="height:19.6pt"><td class="n4">${esc(hNo)}</td><td class="n4">${esc(hMemo)}</td><td class="n4">${esc(hValue)}</td></tr>`,
      rows: input.rows.map(
        (row, i) =>
          `<tr style="height:16.1pt"><td class="n4">${ai(String(i + 1))}</td><td>${esc(ai(settleRowLabel(row.part, String(row.cars))))}</td><td>${latin2(row.amount)}</td></tr>`,
      ),
      total: `<tr style="height:16.1pt"><td>${esc(LETTER_WORDS.settleTotal)}</td><td></td><td>${latin2(input.amount)}</td></tr>`,
      close: '</tbody></table>',
      headH: HEAD_ROW,
      rowH: SETTLE_ROW,
    };
  }
  const head: Block[] = [
    { html: para(dateLine, dPt, dLh), h: dLh + AFTER },
    {
      html: para(`<span class="wl-u">${esc(LETTER_TITLE[input.kind])}</span>`, tPt, tLh, CENTER),
      h: tLh + AFTER,
    },
    { html: para(esc(LETTER_WORDS.greet), gPt, gLh, CENTER), h: gLh + AFTER },
    {
      html: `<p class="body${replenish ? '' : ' wl-c'}" style="font-size:${bPt}pt;line-height:${bLh}pt">${body}</p>`,
      h: linesOf(plain(body), bPt) * bLh + AFTER,
    },
    { html: para(esc(LETTER_WORDS.greet), gPt, gLh), h: gLh + AFTER },
  ];
  const tail: Block[] = [
    { html: blank(gLh), h: gLh + AFTER },
    { html: para(esc(LETTER_WORDS.close), cPt, cLh, CENTER), h: cLh + AFTER },
    { html: para(esc(LETTER_WORDS.regardsComma), cPt, cLh2, CENTER), h: cLh2 + AFTER },
    ...(s1 === undefined ? [] : [{ html: signer1(s1, sPt, sLh), h: signerH(s1, sPt, sLh, WIDTH) }]),
    ...(s2 === undefined
      ? []
      : [{ html: signer2(s2, sPt, sLh), h: signerH(s2, sPt, sLh, SIGNER2_WIDTH) }]),
    ...(s3 === undefined
      ? []
      : [
          {
            html: `${blank(20.7)}${signer3(s3, replenish ? 16 : 14, replenish ? 18.4 : 16.1)}`,
            h:
              20.7 +
              AFTER +
              signerH(s3, replenish ? 16 : 14, replenish ? 18.4 : 16.1, SIGNER3_WIDTH),
          },
        ]),
  ];
  return tableSheets(head, table, tail);
};

/**
 * A letter as its A4 sheets — one, as his are, until its table or its reason runs past Word's
 * bottom margin; then the table goes on over more sheets (each with the letterhead, the frame and
 * the column heads again) and the closing and the signers come on the last, never cut off. The
 * request sentence is the first sheet's `.body`.
 */
export const letterSheets = (input: LetterPaperInput): string[] =>
  input.kind === 'charge' ? chargeLetter(input) : fundLetter(input);

/**
 * «استعاضه عهدة»'s table rows: the memos of each kind together, in his letter's order (كاوتش ·
 * وقود · صيانه · غسيل), a kind with nothing dropped.
 */
export const replenishRowsOf = (
  memos: readonly { kind: FleetCustodySource; total: number }[],
): ReplenishLetterInput['rows'] =>
  TABLE_ORDER.flatMap((kind) => {
    const amount =
      Math.round(
        memos.filter((memo) => memo.kind === kind).reduce((sum, memo) => sum + memo.total, 0) * 100,
      ) / 100;
    return amount !== 0 ? [{ kind, amount }] : [];
  });

const PART_ORDER: Readonly<Record<FleetLicenseExpenseKind, number>> = { renewal: 0, extension: 1 };

/**
 * «تسويه عهدة»'s table rows: one per licensing memo, oldest first, a record's renewal before its
 * extension.
 */
export const settleRowsOf = (
  parts: readonly { part: FleetLicenseExpenseKind; cars: number; amount: number; date: string }[],
): SettleLetterInput['rows'] =>
  parts
    .map((part, index) => ({ part, index }))
    .sort(
      (a, b) =>
        a.part.date.localeCompare(b.part.date) ||
        PART_ORDER[a.part.part] - PART_ORDER[b.part.part] ||
        a.index - b.index,
    )
    .map(({ part }) => ({ part: part.part, cars: part.cars, amount: part.amount }));
