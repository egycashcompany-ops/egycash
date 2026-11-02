// An amount in Egyptian pounds, written out in Arabic — «122 → مائة واثنان وعشرون جنيهًا لا غير».
//
// The words a contract or a salary paper carries beside the figure, so that a figure cannot be
// altered without the words disagreeing with it. Written for the grammar those papers use:
//
//   · «و» between every part — «مائة واثنان وعشرون», never «مائة اثنان وعشرون»;
//   · the counted noun agrees with the number: جنيه واحد · جنيهان · ثلاثة جنيهات · أحد عشر جنيهًا ·
//     مائة جنيه;
//   · a dual or a scale word standing directly before the noun takes its construct form: «مائتا
//     جنيه», «ألفا جنيه», «أحد عشر ألف جنيه» — against «ألفان وخمسمائة» and «اثنا عشر ألفًا
//     وسبعمائة» when more follows;
//   · piastres, when there are any, after the pounds: «… جنيهًا وأربعون قرشًا».
//
// «مائة» rather than «مئة»: the spelling Egyptian official papers use.

const ONES = [
  '', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر',
  'تسعة عشر',
];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = [
  '', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة',
];

interface Scale {
  one: string;
  two: string;
  construct: string;
  plural: string;
  accusative: string;
}
const MILLION: Scale = { one: 'مليون', two: 'مليونان', construct: 'مليونا', plural: 'ملايين', accusative: 'مليونًا' };
const THOUSAND: Scale = { one: 'ألف', two: 'ألفان', construct: 'ألفا', plural: 'آلاف', accusative: 'ألفًا' };

/** 1..999. `last`: only the currency follows — «مائتا جنيه», not «مائتان جنيه». */
const below1000 = (n: number, last = false): string => {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h > 0) parts.push(h === 2 && r === 0 && last ? 'مائتا' : (HUNDREDS[h] ?? ''));
  if (r > 0 && r < 20) parts.push(ONES[r] ?? '');
  else if (r >= 20) {
    const o = r % 10;
    const ten = TENS[Math.floor(r / 10)] ?? '';
    parts.push(o > 0 ? `${ONES[o] ?? ''} و${ten}` : ten);
  }
  return parts.join(' و');
};

/** A group with its scale word; `last` when nothing but the currency follows it. */
const scaled = (g: number, w: Scale, last: boolean): string => {
  if (g === 1) return w.one;
  if (g === 2) return last ? w.construct : w.two;
  if (g >= 3 && g <= 10) return `${below1000(g)} ${w.plural}`;
  if (g === 200) return `مائتا ${w.one}`;
  return `${below1000(g)} ${g % 100 >= 11 && !last ? w.accusative : w.one}`;
};

const integerWords = (n: number): string => {
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (millions > 0) parts.push(scaled(millions, MILLION, thousands === 0 && rest === 0));
  if (thousands > 0) parts.push(scaled(thousands, THOUSAND, rest === 0));
  if (rest > 0) parts.push(below1000(rest, true));
  return parts.join(' و');
};

type Noun = readonly [one: string, two: string, few: string, many: string];
const POUND: Noun = ['جنيه', 'جنيهان', 'جنيهات', 'جنيهًا'];
const PIASTRE: Noun = ['قرش', 'قرشان', 'قروش', 'قرشًا'];

/** A whole count with its noun, agreeing with it. */
const counted = (n: number, [one, two, few, many]: Noun): string => {
  if (n === 1) return `${one} واحد`;
  if (n === 2) return two;
  const r = n % 100;
  const noun = r >= 3 && r <= 10 ? few : r >= 11 ? many : one;
  return `${integerWords(n)} ${noun}`;
};

/**
 * `amount` in pounds, written out, ending «لا غير». Rounded to the piastre. Up to 999,999,999.99;
 * a negative or larger amount is not a salary and returns an empty string rather than a wrong one.
 */
export const amountInArabicWords = (amount: number): string => {
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1_000_000_000) return '';
  const total = Math.round(amount * 100);
  const pounds = Math.floor(total / 100);
  const piastres = total % 100;
  const parts: string[] = [];
  if (pounds > 0) parts.push(counted(pounds, POUND));
  if (piastres > 0) parts.push(counted(piastres, PIASTRE));
  if (parts.length === 0) parts.push('صفر جنيه');
  return `${parts.join(' و')} لا غير`;
};
