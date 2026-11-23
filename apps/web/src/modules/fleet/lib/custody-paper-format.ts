// The custody papers' numbers and dates, as his Excel and Word files write them — every figure in
// Latin digits 0-9 (owner, 2026-11-23: «اى ارقام بالانجلش»).
//
// The Excel memos print Excel's own formats («General», «0.00», «#,##0»). The Word letters print the
// same Latin digits — a Latin comma between the thousands and «.» before piastres — not Word's
// «Context» numerals any more. NEVER `Intl` with 'ar-EG': it writes Arabic-Indic digits and groups
// with «٬», which is not his paper. The tatweel is built from its code point, so this file carries
// no Arabic character of its own (only `custody-paper-wording.ts` does).

/** «ـ» — the tatweel his period dates are joined with. */
export const TATWEEL = '\u0640';

/** Escapes text for HTML — EVERY user value on a paper goes through it. */
export const esc = (text: string): string =>
  text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');

/** To the piastre. */
export const r2 = (value: number): number => Math.round(value * 100) / 100;

const isWhole = (value: number): boolean => Math.round(value * 100) % 100 === 0;

/** Excel's «General»: 5230, 40, 12.5 — no grouping, no trailing zeros. */
export const general = (value: number): string => String(r2(value));

/** Excel's «0.00»: 5720.00, 12500.00 — two decimals, no grouping. */
export const fixed2 = (value: number): string => r2(value).toFixed(2);

/**
 * Excel's «#,##0»: 50,109 — and «#,##0.00» when there are piastres, never rounded away. The Word
 * letters' amounts too: «81,908», «124,139.46».
 */
export const grouped = (value: number): string =>
  value.toLocaleString('en-US', {
    minimumFractionDigits: isWhole(value) ? 0 : 2,
    maximumFractionDigits: isWhole(value) ? 0 : 2,
  });

/** «23/8/2026» — his Excel dates: day/month/year, no leading zeros. */
export const dMy = (isoDay: string): string => {
  const [y = '', m = '', d = ''] = isoDay.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

/** «39,732.19» — the settle letter's table, typed in a Latin run: Latin, always two decimals. */
export const latin2 = (value: number): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The tatweel between the parts of his period dates, in the face that draws it on the baseline. */
const TATWEEL_HTML = `<span class="tw">${TATWEEL}</span>`;

/**
 * «01ـ09ـ2026» (the replenish letter, day padded) or «1ـ09ـ2026» (the settle letter) — HTML, Latin
 * digits, the tatweel on the baseline between the parts.
 */
export const tatweelDate = (isoDay: string, padDay: boolean): string => {
  const [y = '', m = '', d = ''] = isoDay.split('-');
  return [padDay ? d : String(Number(d)), m, y].join(TATWEEL_HTML);
};

/** 'YYYY-MM-DD' out of a wire date — a day already, or a full ISO string. */
export const dayOf = (iso: string): string => iso.slice(0, 10);
