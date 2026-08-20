// Number, weight and date formatting for the Gold module — the gold system's `lib/format.js`,
// carried across.
//
// Weights are grams with Latin digits, and dates are Arabic month names with Latin digits
// (`ar-EG-u-nu-latn`). Both are deliberate and both are the gold system's: a vault operator reads
// serial numbers and weights off a scale in Latin digits all day, and a receipt whose weight came
// out in Arabic-Indic digits would not match the paper beside it.
import { type GoldMetalType } from '@ecms/contracts';

export const fmtNumber = (n: number | null | undefined): string =>
  Number(n ?? 0).toLocaleString('en-US');

export const fmtWeightValue = (g: number | null | undefined): string =>
  Number(g ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const fmtDecimal2 = (n: number | null | undefined): string =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtKilos = (g: number | null | undefined): string =>
  (Number(g ?? 0) / 1000).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const fmtDate = (iso: string | null | undefined): string =>
  iso === null || iso === undefined || iso === ''
    ? '—'
    : new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

export const fmtDateTime = (iso: string | null | undefined): string =>
  iso === null || iso === undefined || iso === ''
    ? '—'
    : new Date(iso).toLocaleString('ar-EG-u-nu-latn', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

/** `YYYY-MM-DD`, the value shape every `<input type="date">` in this module uses. */
export const toDateInput = (iso: string | null | undefined): string =>
  iso === null || iso === undefined || iso === '' ? '' : new Date(iso).toISOString().slice(0, 10);

export const todayInput = (): string => new Date().toISOString().slice(0, 10);

export const METAL_TYPES: GoldMetalType[] = ['gold', 'silver', 'platinum', 'palladium', 'other'];

/**
 * A drawer's fill, as a 0..1.2 ratio (the gold curve: above 1 means over its limit).
 * A drawer with NO limit reads as half full when it holds anything — the limit is indicative, and
 * the bar is there to show occupancy, not to imply a rule that was never set.
 */
export const fillRatio = (weight: number, limit: number): number => {
  if (limit <= 0) return weight > 0 ? 0.5 : 0;
  return Math.min(weight / limit, 1.2);
};

const lerpHsl = (
  a: { h: number; s: number; l: number },
  b: { h: number; s: number; l: number },
  t: number,
): string => {
  const h = a.h + (b.h - a.h) * t;
  const s = a.s + (b.s - a.s) * t;
  const l = a.l + (b.l - a.l) * t;
  return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`;
};

/**
 * The gold fill gradient: grey (empty) → green → yellow → orange → red (over the limit).
 * These are STATE colours, not brand colours, so they are the same in both themes — the whole
 * point of the board is that a full drawer looks full at a glance.
 */
export const fillColor = (ratio: number): string => {
  if (ratio <= 0) return 'rgba(148, 163, 184, 0.25)';
  if (ratio <= 0.25)
    return lerpHsl({ h: 146, s: 50, l: 58 }, { h: 142, s: 60, l: 44 }, ratio / 0.25);
  if (ratio <= 0.75) {
    return lerpHsl({ h: 52, s: 80, l: 60 }, { h: 46, s: 88, l: 48 }, (ratio - 0.25) / 0.5);
  }
  if (ratio <= 1) {
    return lerpHsl({ h: 34, s: 88, l: 58 }, { h: 26, s: 90, l: 48 }, (ratio - 0.75) / 0.25);
  }
  return 'hsl(2 72% 52%)';
};

/** A stable colour per owner, so the same company reads the same on every drawer. */
export const companyColor = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${String(h)} 72% 66%)`;
};
