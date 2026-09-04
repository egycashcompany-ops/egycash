// Every case here is a shape that occurs in the real go-live workbook. This is not a generic
// parser suite — it is the list of ways twenty years of hand-maintained spreadsheet lies, and each
// test names the count that made it worth guarding.
import { describe, expect, it } from 'vitest';
import { date, flag, nationalId, num, phone, text, year } from './cell';

describe('text — the "looks filled, means empty" family', () => {
  it('rejects the placeholder characters the sheet uses instead of blanks', () => {
    // Counts across both sheets: tatweel 16,448 · underscore 1,727 · hyphen 1,371 · double 1,263.
    for (const p of ['ـ', 'ــ', '_', '-', '–', '—', '.', '/', '\\', '|', '+', '*', '#', '  ']) {
      expect(text(p), p).toBeNull();
    }
  });

  it('rejects a held-down key, whatever the character', () => {
    expect(text('ااااااااااااااااااااااااا')).toBeNull();
    expect(text('0000000000')).toBeNull();
    expect(text('..........')).toBeNull();
  });

  it('keeps a short repeated string that is a real value', () => {
    // Three characters is under the run threshold — `ججج` is not obviously a held key.
    expect(text('ججج')).toBe('ججج');
  });

  it('strips the bidi marks Excel embeds in Arabic cells', () => {
    expect(text('‏المهندسين‎')).toBe('المهندسين');
  });

  it('collapses internal whitespace so one section is not two', () => {
    // `التشغيل ( خارجى )` and `التشغيل  (  خارجى  )` are the same section typed twice.
    expect(text('التشغيل  (  خارجى  )')).toBe('التشغيل ( خارجى )');
  });

  it('does not treat a Date as text', () => {
    expect(text(new Date('2020-01-05T00:00:00.000Z'))).toBeNull();
  });
});

describe('num', () => {
  it('keeps a filed zero, which is a figure and not a blank', () => {
    // Sixteen employees carry `الاجر الأساسي` of 0. Returning null would erase a real filing.
    expect(num(0)).toBe(0);
    expect(num('0')).toBe(0);
  });

  it('reads a number Excel stored as text, commas and all', () => {
    expect(num('12,600')).toBe(12600);
    expect(num(' 2362.5 ')).toBe(2362.5);
  });

  it('reads Arabic-Indic digits', () => {
    expect(num('١٩٢٠')).toBe(1920);
  });

  it('refuses a placeholder and a non-number', () => {
    expect(num('ـ')).toBeNull();
    expect(num('نهائي')).toBeNull();
    expect(num('')).toBeNull();
  });
});

describe('date — three encodings live in the same column', () => {
  it('passes a real Date through', () => {
    const d = new Date('2020-01-05T00:00:00.000Z');
    expect(date(d)).toBe(d);
  });

  /**
   * The Resignation sheet holds 31 birth dates as raw serials. The corrective for Excel's
   * non-existent 1900 leap day is what makes this land on the right day rather than one before.
   */
  it('converts an Excel serial to the day it actually means', () => {
    expect(date(34921)?.toISOString()).toBe('1995-08-10T00:00:00.000Z');
    expect(date(1)).toBeNull(); // 1900-01-01 — below the plausibility floor, so not a date
  });

  it('converts a serial stored as text', () => {
    expect(date('34921')?.toISOString()).toBe('1995-08-10T00:00:00.000Z');
  });

  /**
   * The one that would corrupt the most records silently. 1,066 Master birth dates are `d/m/yyyy`
   * text; reading them month-first moves a birthday for every row whose day is ≤ 12 — roughly
   * 40% of them — and produces a perfectly valid date nobody would question.
   */
  it('reads text dates DAY-first, never month-first', () => {
    expect(date('3/4/1995')?.toISOString()).toBe('1995-04-03T00:00:00.000Z');
    expect(date('21/6/1979')?.toISOString()).toBe('1979-06-21T00:00:00.000Z');
    expect(date('05.01.2020')?.toISOString()).toBe('2020-01-05T00:00:00.000Z');
  });

  it('refuses a date that does not exist rather than rolling it into next month', () => {
    expect(date('31/02/1990')).toBeNull();
    expect(date('32/01/1990')).toBeNull();
    expect(date('10/13/1990')).toBeNull();
  });

  it('refuses an insurance number sitting in a date column', () => {
    // `c4` holds eight-digit insurance numbers; as a serial that would be the year 200,000-odd.
    expect(date(76793521)).toBeNull();
  });

  it('refuses the words that appear in date columns', () => {
    // `تاريخ التحديث` holds 252 text values like this one.
    expect(date('نهائي')).toBeNull();
    expect(date('ـ')).toBeNull();
  });

  it('builds at UTC midnight so a date cannot drift a day by timezone', () => {
    expect(date('1/1/2020')?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('nationalId', () => {
  it('accepts the fourteen digits and drops separators', () => {
    expect(nationalId('28106012104454')).toBe('28106012104454');
    expect(nationalId(' 281-0601-2104454 ')).toBe('28106012104454');
  });

  it('refuses anything that is not fourteen digits', () => {
    expect(nationalId('2810601210445')).toBeNull();
    expect(nationalId('ـ')).toBeNull();
    expect(nationalId(null)).toBeNull();
  });
});

describe('phone', () => {
  it('normalizes the prefixes the sheet mixes', () => {
    expect(phone('01125232225')).toBe('01125232225');
    expect(phone('+201125232225')).toBe('01125232225');
    expect(phone('00201125232225')).toBe('01125232225');
    expect(phone('1125232225')).toBe('01125232225');
  });

  it('drops anything that is not a mobile number rather than guessing', () => {
    // This is what credential delivery would dial — a wrong guess texts a stranger.
    expect(phone('0221234567')).toBeNull();
    expect(phone('123')).toBeNull();
    expect(phone('ـ')).toBeNull();
  });
});

describe('flag', () => {
  it('reads any real mark as yes', () => {
    for (const v of ['نعم', 'تم', '1', 'x', 'خبرة']) expect(flag(v), v).toBe(true);
  });

  it('reads a placeholder or a blank as no', () => {
    for (const v of ['ـ', '-', '', '   ', null, undefined]) expect(flag(v)).toBe(false);
  });
});

describe('year', () => {
  it('accepts a graduation year', () => {
    expect(year(2004)).toBe(2004);
    expect(year('2018')).toBe(2018);
  });

  it('takes the year out of the stray date in that column', () => {
    // `تاريخ المؤهل` holds one Date among 1,651 integers.
    expect(year(new Date('2015-06-01T00:00:00.000Z'))).toBe(2015);
  });

  it('refuses a value that is not a year', () => {
    expect(year(168)).toBeNull();
    expect(year('ـ')).toBeNull();
  });
});
