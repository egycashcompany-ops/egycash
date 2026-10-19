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

/** «صرف عهدة» — the .docx itself, paragraph by paragraph. */
const chargeLetter = (input: ChargeLetterInput): string => {
  const [y = '', m = '', d = ''] = input.date.split('-');
  const { s1, s2, s3 } = signsOf(input.signatures);
  const reason = reasonOf(input.reason);
  const request = chargeRequest(aiAmount(input.amount));
  // His two body paragraphs, as one block: the request, then the reason after a Word line break.
  const body =
    reason === ''
      ? request
      : `${request}${CHARGE_FOR}<span class="wl-br"></span>${chargeReason(esc(reason))}`;
  return letterPage(
    [
      para(
        `<span style="font-size:10pt">${esc(LETTER_WORDS.date)}</span> ${ai(`${Number(d)}/${Number(m)}/${y}`)}`,
        14,
        17.4,
      ),
      para(`<span class="wl-u">${esc(LETTER_TITLE.charge)}</span>`, 20, 24.8, CENTER),
      blank(22.3),
      `<div class="body" style="font-size:18pt;line-height:22.3pt">${body}</div>`,
      blank(13.65),
      blank(13.65),
      para(esc(LETTER_WORDS.close), 16, 19.9, CENTER),
      para(esc(LETTER_WORDS.regards), 16, 18.4, CENTER),
      s1 === undefined ? '' : signer1(s1, 16, 18.4),
      s1 === undefined || s2 === undefined ? '' : blank(18.4),
      s2 === undefined ? '' : signer2(s2, 16, 18.4),
      s3 === undefined ? '' : `${blank(20.7)}${blank(20.7)}${blank(20.7)}${signer3(s3, 18, 20.7)}`,
    ].join(''),
  );
};

/** «استعاضه عهدة» (124) and «تسويه عهدة» (129) — the same letter, the settle one a Word size smaller. */
const fundLetter = (input: ReplenishLetterInput | SettleLetterInput): string => {
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
  let table: string;
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
    table = `<table class="wl-t ar n4" style="width:463.8pt;margin-right:-5.4pt;font-family:var(--arial);font-size:16pt;line-height:18.4pt"><colgroup><col style="width:132.4pt" /><col style="width:176.5pt" /><col style="width:154.9pt" /></colgroup><tbody><tr style="height:19.6pt"><td>${esc(hNo)}</td><td>${esc(hMemo)}</td><td>${esc(hValue)}</td></tr>${input.rows
      .map(
        (row, i) =>
          `<tr style="height:18.7pt"><td>${ai(String(i + 1))}</td><td>${esc(KIND_WORD[row.kind])}</td><td>${aiAmount(row.amount)}</td></tr>`,
      )
      .join(
        '',
      )}<tr style="height:18.7pt"><td>${esc(LETTER_WORDS.replenishTotal)}</td><td></td><td>${aiAmount(input.amount)}</td></tr></tbody></table>`;
  } else {
    body = settleBody(
      aiAmount(input.amount),
      aiAmount(input.custody),
      tatweelDate(from, false),
      tatweelDate(to, false),
    );
    const [hNo = '', hMemo = '', hValue = ''] = LETTER_WORDS.tableHeads;
    table = `<table class="wl-t" style="width:456pt;font-size:14pt;line-height:16.1pt"><colgroup><col style="width:148.9pt" /><col style="width:197.6pt" /><col style="width:109.6pt" /></colgroup><tbody><tr style="height:19.6pt"><td class="n4">${esc(hNo)}</td><td class="n4">${esc(hMemo)}</td><td class="n4">${esc(hValue)}</td></tr>${input.rows
      .map(
        (row, i) =>
          `<tr style="height:16.1pt"><td class="n4">${ai(String(i + 1))}</td><td>${esc(ai(settleRowLabel(row.part, String(row.cars))))}</td><td>${latin2(row.amount)}</td></tr>`,
      )
      .join(
        '',
      )}<tr style="height:16.1pt"><td>${esc(LETTER_WORDS.settleTotal)}</td><td></td><td>${latin2(input.amount)}</td></tr></tbody></table>`;
  }
  return letterPage(
    [
      para(dateLine, dPt, dLh),
      para(`<span class="wl-u">${esc(LETTER_TITLE[input.kind])}</span>`, tPt, tLh, CENTER),
      para(esc(LETTER_WORDS.greet), gPt, gLh, CENTER),
      `<p class="body${replenish ? '' : ' wl-c'}" style="font-size:${bPt}pt;line-height:${bLh}pt">${body}</p>`,
      para(esc(LETTER_WORDS.greet), gPt, gLh),
      table,
      blank(gLh),
      para(esc(LETTER_WORDS.close), cPt, cLh, CENTER),
      para(esc(LETTER_WORDS.regardsComma), cPt, cLh2, CENTER),
      s1 === undefined ? '' : signer1(s1, sPt, sLh),
      s2 === undefined ? '' : signer2(s2, sPt, sLh),
      s3 === undefined
        ? ''
        : `${blank(20.7)}${signer3(s3, replenish ? 16 : 14, replenish ? 18.4 : 16.1)}`,
    ].join(''),
  );
};

/** A letter as its one A4 sheet. The request sentence is the sheet's `.body`. */
export const letterSheets = (input: LetterPaperInput): string[] => [
  input.kind === 'charge' ? chargeLetter(input) : fundLetter(input),
];

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
