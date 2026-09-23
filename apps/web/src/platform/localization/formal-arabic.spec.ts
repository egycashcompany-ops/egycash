// The Arabic in this product is formal Arabic, and stays that way.
//
// «خلى كله الكلام اللى رسمى واللى يتكتب بعد كدا كلام رسمى» — the second half of that is what this
// file is for. Rewriting the colloquial entries once was an afternoon's work; keeping them out is
// only possible if something fails when the next one is added, because nobody reviewing a diff of
// six thousand strings will catch «مش» in one of them.
//
// WHAT COUNTS AS A TELL. Only forms that have no formal reading at all are listed. That rules out
// a long tail of words which are colloquial in some sentences and correct in others — «جرّب» is
// ordinary Arabic, «الحاجة» is a noun in «عند الحاجة» — because a guard that cries wolf gets
// weakened until it catches nothing. What is here is the Egyptian register's own vocabulary and
// its verb prefixes, which cannot appear in formal prose by accident.
//
// The English dictionary is not checked: its register was never in question.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'i18n.ts'), 'utf8');

const AR_START = SOURCE.indexOf('const ar: Record<string, string> = {');
/**
 * What counts as "inside a word" when looking for a whole-word tell.
 *
 * The WHOLE Arabic block, not just the letters: a kasra or a shadda between two letters is not a
 * word boundary, and treating it as one made «ده» match inside «أعِده» and «تولّده» — which is how
 * a guard earns its reputation for crying wolf.
 */
const ARABIC_LETTER = '؀-ۿ';

/**
 * Forms with no formal reading.
 *
 * `whole` is matched between non-letters, because «ده» lives inside «تولّده» and «اللي» inside
 * «الليل»; `any` is matched anywhere, because those spellings exist nowhere else.
 */
const TELLS: readonly { form: string; kind: 'whole' | 'any'; instead: string }[] = [
  { form: 'مش', kind: 'whole', instead: 'ليس / غير / لا' },
  { form: 'مفيش', kind: 'any', instead: 'لا يوجد' },
  { form: 'دلوقتي', kind: 'any', instead: 'الآن' },
  { form: 'دلوقتى', kind: 'any', instead: 'الآن' },
  { form: 'عشان', kind: 'any', instead: 'لأن / حتى / لكي' },
  { form: 'علشان', kind: 'any', instead: 'لأن / حتى / لكي' },
  { form: 'بتاع', kind: 'any', instead: 'الخاص بـ / التابع لـ' },
  { form: 'بتوع', kind: 'any', instead: 'الخاصون بـ' },
  { form: 'لسه', kind: 'any', instead: 'ما زال / بعد' },
  { form: 'اللي', kind: 'whole', instead: 'الذي / التي / ما' },
  { form: 'اللى', kind: 'whole', instead: 'الذي / التي / ما' },
  { form: 'عايز', kind: 'any', instead: 'يريد / إذا أردت' },
  { form: 'عاوز', kind: 'any', instead: 'يريد / إذا أردت' },
  { form: 'كده', kind: 'any', instead: 'ذلك / هكذا' },
  { form: 'كدا', kind: 'whole', instead: 'ذلك / هكذا' },
  { form: 'ازاي', kind: 'any', instead: 'كيف' },
  { form: 'إزاي', kind: 'any', instead: 'كيف' },
  { form: 'ده', kind: 'whole', instead: 'هذا' },
  { form: 'دي', kind: 'whole', instead: 'هذه' },
  { form: 'دول', kind: 'whole', instead: 'هؤلاء' },
  { form: 'إيه', kind: 'whole', instead: 'ما / ماذا' },
  { form: 'كتير', kind: 'any', instead: 'كثير' },
  { form: 'زرار', kind: 'any', instead: 'زر' },
  { form: 'محدش', kind: 'any', instead: 'لا أحد' },
  { form: 'ملوش', kind: 'any', instead: 'ليس له' },
  { form: 'مالوش', kind: 'any', instead: 'ليس له' },
  { form: 'شوية', kind: 'any', instead: 'قليل / بعض' },
  { form: 'استنى', kind: 'any', instead: 'انتظر / يُرجى الانتظار' },
  { form: 'بعدين', kind: 'any', instead: 'لاحقًا' },
  { form: 'لوحده', kind: 'any', instead: 'منفردًا / بمفرده' },
  { form: 'لوحدها', kind: 'any', instead: 'منفردة / بمفردها' },
  { form: 'الجداد', kind: 'any', instead: 'الجدد' },
  { form: 'شغّال', kind: 'any', instead: 'يعمل / قيد التشغيل' },
  { form: 'الاتنين', kind: 'any', instead: 'كليهما / الاثنين' },
  { form: 'تلات', kind: 'whole', instead: 'ثلاث' },
  { form: 'كام', kind: 'whole', instead: 'كم' },
  { form: 'فين', kind: 'whole', instead: 'أين' },
  { form: 'ازيك', kind: 'any', instead: 'كيف حالك' },
  { form: 'حاجات', kind: 'whole', instead: 'أشياء / عناصر' },
  { form: 'القايمة', kind: 'any', instead: 'القائمة' },
  { form: 'الداتا', kind: 'any', instead: 'البيانات' },
  { form: 'السيستم', kind: 'any', instead: 'النظام' },
];

/** Every value in the Arabic dictionary, with the key it belongs to. */
const arabicEntries = (): { key: string; value: string }[] => {
  const body = SOURCE.slice(AR_START);
  const out: { key: string; value: string }[] = [];
  // Key, then everything up to the quote-comma that closes the value. Values may span lines.
  const entry = /'([a-zA-Z0-9_.\-[\]]+)':\s*((?:'[^']*'\s*\+?\s*)+),/g;
  let match = entry.exec(body);
  while (match !== null) {
    const key = match[1] ?? '';
    const value = (match[2] ?? '').replace(/'\s*\+?\s*'/g, '').replace(/^'|'$/g, '');
    out.push({ key, value });
    match = entry.exec(body);
  }
  return out;
};

const offendersIn = (value: string): string[] =>
  TELLS.filter(({ form, kind }) =>
    kind === 'any'
      ? value.includes(form)
      : new RegExp(`(?:^|[^${ARABIC_LETTER}])${form}(?:$|[^${ARABIC_LETTER}])`, 'u').test(value),
  ).map(({ form, instead }) => `«${form}» → ${instead}`);

describe('the Arabic the product speaks is formal Arabic', () => {
  const entries = arabicEntries();

  it('reads the dictionary at all — a guard over nothing passes forever', () => {
    // The parser above is a regex over source, so it has to be proved to have found the strings
    // before its silence about them means anything.
    expect(AR_START).toBeGreaterThan(-1);
    expect(entries.length).toBeGreaterThan(5000);
    expect(entries.find((e) => e.key === 'platform.auth.login.wrongPassword')?.value).toContain(
      'كلمة المرور',
    );
  });

  it('contains no Egyptian colloquial form, in any message', () => {
    const offenders = entries
      .map((entry) => ({ key: entry.key, found: offendersIn(entry.value) }))
      .filter((entry) => entry.found.length > 0)
      .map((entry) => `${entry.key}: ${entry.found.join(', ')}`);
    // Printed in full rather than counted: whoever trips this needs the key and the replacement,
    // not the news that a number went up.
    expect(offenders).toEqual([]);
  });

  it('still catches a colloquial string if one is added', () => {
    // The list above is only worth what it detects, and a typo in one of these forms would make
    // the check above pass over a dictionary full of them.
    expect(offenders('الملف ده مش هيتحفظ')).toContain('«مش» → ليس / غير / لا');
    expect(offenders('الملف ده مش هيتحفظ')).toContain('«ده» → هذا');
    expect(offenders('مفيش حاجات هنا دلوقتي')).toHaveLength(3);
    // …and leaves formal Arabic alone, including the words that merely contain a tell.
    for (const formal of [
      'أعِده للمتقدم',
      'تعبر منتصف الليل',
      'جرّب اسمًا آخر',
      'أنشئ أمرًا عند الحاجة',
      'لا توجد بيانات',
      'هذه الإدارة مسجَّلة بالفعل',
    ]) {
      expect(offenders(formal), formal).toEqual([]);
    }
  });
});

/** Exported shape of the check, so the self-test above reads the same way the scan does. */
function offenders(value: string): string[] {
  return offendersIn(value);
}
