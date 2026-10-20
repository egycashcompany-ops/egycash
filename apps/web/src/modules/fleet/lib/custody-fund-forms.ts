// The fund's three dialogs — «شحن العهدة», «استعاضة العهدة», «تسوية العهدة» — as arithmetic and
// request bodies, with no React and no words: what the dialogs show and send is decided here, so
// the node suite can read it directly.
//
// Money is added in whole piastres, as the API adds it, so «إجمالي العهدة بعدها» on the screen is
// the figure the server will record. Nothing on these forms is mandatory beyond the arithmetic:
// a box left empty is LEFT OUT of the body (never sent as `''`, which the server reads as an
// invalid date) and the server fills in its own default — today for the letter's date, the whole
// months of what was picked for its period, the same rule `monthBounds` draws on the screen.
import {
  type CreateFleetCustodyCharge,
  type CreateFleetCustodyReplenishment,
  type CreateFleetCustodySettlement,
  type FleetCustodySource,
  type FleetLicenseExpenseKind,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { writeRefusalOf } from './write-refusal';

/**
 * Today as the fund's forms write it, `YYYY-MM-DD` — the CALENDAR day on the clerk's own clock, as
 * the memo editor's `today()` reads it. (The UTC day would be yesterday from Cairo's midnight to
 * 02:00/03:00, and the letter would print it.) The body then carries that day as UTC midnight.
 */
export const todayDay = (now: Date = new Date()): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * The letter's period when nobody typed one: the first day of the earliest month to the last day
 * of the latest month the picked things fall in — his «عن الفترة من 01/09 إلى 30/09». Anything
 * that is not a `YYYY-MM-DD` day is passed over; nothing picked is `null`.
 */
export const monthBounds = (days: readonly string[]): { from: string; to: string } | null => {
  const valid = days.map((day) => day.slice(0, 10)).filter((day) => DAY.test(day));
  if (valid.length === 0) return null;
  const sorted = [...valid].sort();
  const first = sorted[0] as string;
  const last = sorted[sorted.length - 1] as string;
  const [, y = '', m = ''] = DAY.exec(last) ?? [];
  // Day 0 of the next month is the last day of this one — leap years included.
  const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return {
    from: `${first.slice(0, 7)}-01`,
    to: `${last.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`,
  };
};

const piastres = (value: number): number => Math.round(value * 100);

/** A sum of money, added in whole piastres. */
export const sumMoney = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + piastres(value), 0) / 100;

/** «إجمالي العهدة بعدها» — the fund now plus the change (signed), to the piastre. May be negative. */
export const fundAfter = (before: number, change: number): number =>
  (piastres(before) + piastres(change)) / 100;

/** «المبلغ» as typed, when it is an amount the fund can be charged with; else `null`. */
/** The most a «شحن العهدة» may record — the contract's own ceiling. */
export const CHARGE_AMOUNT_MAX = 1_000_000_000;

/** «وذلك نظير» — the contract's own limit. */
export const CHARGE_REASON_MAX = 500;

/** A letter's period reads forward: «إلى» never before «من» (an open end is always in order). */
export const periodInOrder = (period: { from: string; to: string }): boolean =>
  period.from === '' || period.to === '' || period.from <= period.to;

export const chargeAmountOf = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
};

/** The letter's head as the dialog holds it: the date, and a period typed over the automatic one. */
export interface LetterHead {
  /** `''` when the box was emptied — the server then writes today. */
  date: string;
  /** `null` while the box follows what is picked (`monthBounds`); else what was typed. */
  from: string | null;
  to: string | null;
}

export const freshLetterHead = (now: Date = new Date()): LetterHead => ({
  date: todayDay(now),
  from: null,
  to: null,
});

/** The period the boxes show: what was typed, else the months of what is picked. */
export const letterPeriod = (
  head: LetterHead,
  days: readonly string[],
): { from: string; to: string } => {
  const auto = monthBounds(days);
  return { from: head.from ?? auto?.from ?? '', to: head.to ?? auto?.to ?? '' };
};

/** A typed day as the body carries it — that day's UTC midnight, as every Fleet form sends one. */
export const dayDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** `date`, `from`, `to` — each only when it holds a day. */
const headBody = (
  date: string,
  period: { from: string; to: string },
): { date?: Date; from?: Date; to?: Date } => ({
  ...(DAY.test(date) ? { date: dayDate(date) } : {}),
  ...(DAY.test(period.from) ? { from: dayDate(period.from) } : {}),
  ...(DAY.test(period.to) ? { to: dayDate(period.to) } : {}),
});

/** «تنفيذ الاستعاضة» — the ticked memos, the letter's date and period as shown. */
export const replenishBody = (input: {
  date: string;
  period: { from: string; to: string };
  memoIds: readonly string[];
}): CreateFleetCustodyReplenishment => ({
  ...headBody(input.date, input.period),
  memoIds: [...input.memoIds],
});

/** «تنفيذ التسوية» — the ticked licence parts (renewal and extension of one record are two). */
export const settleBody = (input: {
  date: string;
  period: { from: string; to: string };
  parts: readonly { expenseId: string; part: FleetLicenseExpenseKind }[];
}): CreateFleetCustodySettlement => ({
  ...headBody(input.date, input.period),
  parts: input.parts.map(({ expenseId, part }) => ({ expenseId, part })),
});

/**
 * «حفظ» on «شحن العهدة» — the amount, its date and «وذلك نظير» as typed (trimmed; the server drops
 * a leading «نظير», and the letter and the ledger write it back).
 */
export const chargeBody = (input: {
  date: string;
  amount: number;
  reason: string;
}): CreateFleetCustodyCharge => ({
  ...(DAY.test(input.date) ? { date: dayDate(input.date) } : {}),
  amount: input.amount,
  reason: input.reason.trim(),
});

/** His letters' order: كاوتش · وقود · صيانة · غسيل (`FLEET_CUSTODY_SOURCES` is the board's). */
export const LETTER_KIND_ORDER: readonly FleetCustodySource[] = [
  'tyres',
  'fuel',
  'maintenance',
  'wash',
];

/** `kinds` in the letter's order — the ledger's arrive in the board's. */
export const inLetterOrder = (kinds: readonly FleetCustodySource[]): FleetCustodySource[] =>
  LETTER_KIND_ORDER.filter((kind) => kinds.includes(kind));

export interface KindShare {
  kind: FleetCustodySource;
  /** The picked memos' total of this kind — 0 when none of this kind is picked. */
  total: number;
  /** Their numbers, smallest first. */
  nos: number[];
}

/** «ملخص الاستعاضة حسب النوع» — one tile per kind, in the letter's order, empty kinds kept. */
export const byKindInLetterOrder = (
  memos: readonly { kind: FleetCustodySource; no: number; total: number }[],
): KindShare[] =>
  LETTER_KIND_ORDER.map((kind) => {
    const mine = memos.filter((memo) => memo.kind === kind);
    return {
      kind,
      total: sumMoney(mine.map((memo) => memo.total)),
      nos: mine.map((memo) => memo.no).sort((a, b) => a - b),
    };
  });

/** One licence part's key in «تسوية العهدة» — a record's renewal and its extension are two rows. */
export const settlePartKey = (part: { expenseId: string; part: FleetLicenseExpenseKind }): string =>
  `${part.expenseId}:${part.part}`;

/** Five codes fit the line; a longer list shows four and says how many more. */
export const codesShown = (codes: readonly string[]): { shown: string[]; more: number } => {
  const shown = codes.length > 5 ? codes.slice(0, 4) : [...codes];
  return { shown, more: codes.length - shown.length };
};

/** Flip one id in a set. */
export const toggled = (held: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(held);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/**
 * Why the server refused a fund operation, when that is something the dialog can name:
 *   taken   409 / 404 — a memo was replenished or deleted, a licence part settled, changed or
 *                       deleted, after the dialog read its list (the list is read again);
 *   locked  422 — a business rule (`write-refusal.ts`);
 *   stale   409 — a record's version moved (`write-refusal.ts`).
 * `null` for anything else, which keeps its usual message.
 */
export type FundRefusal = 'taken' | 'locked' | 'stale';
export const fundRefusalOf = (error: unknown): FundRefusal | null => {
  const refusal = writeRefusalOf(error);
  if (refusal !== null) return refusal;
  if (error instanceof ApiError && (error.status === 409 || error.status === 404)) return 'taken';
  return null;
};
